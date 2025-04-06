import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; 
  ovalEccentricity: number;
  mouthOpening: number;  // 0 = closed oval, 1 = half oval (maximum opening)
  showWaves: boolean;    // Whether to show the wave visualization
}

interface Particle {
  body: Matter.Body;
  groupId: number;
  cycleNumber: number;
  index: number; 
  energy: number; 
  initialEnergy: number;
  collided: number; // 0 = never collided, 1+ = collided at least once
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  particles: Particle[];
  groupId: number;
  cycleNumber: number;
  energy: number;
  initialEnergy: number;
}

// New interface for representing a point in 2D space
interface Point2D {
  x: number;
  y: number;
}


// Interface for segment glow data
interface SegmentGlow {
  intensity: number;
  lastUpdateTime: number;
  segmentId: number;
}


export class CanvasController {
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.5;  
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 3;
  private static readonly PHYSICS_TIMESTEP_MS: number = 8; 
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; 
  private static readonly PARTICLES_PER_RING: number = 98;
  private static readonly PARTICLE_RADIUS: number = 0.1;
  private static readonly FIXED_BUBBLE_RADIUS: number = 3; 
  private static readonly PARTICLE_ANGLES: number[] = (() => {
    const particleAngles: number[] = [];
    const baseAngles: number[] = [];
    const particleCount = CanvasController.PARTICLES_PER_RING;
    const halfCount = Math.floor(particleCount / 2);

    // Add center particle at 0°
    baseAngles.push(0);

    // Add symmetric pairs of particles
    for (let i = 1; i <= halfCount; i++) {
      const angle = (i / halfCount) * Math.PI;
      baseAngles.push(angle);
      baseAngles.push(-angle);
    }

    // Apply compression to focus particles toward the front
    for (const angle of baseAngles) {
      particleAngles.push(angle);
    }

    return particleAngles.sort((a, b) => a - b);
  })();

  // State variables
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWidth: number;
  private canvasHeight: number;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];
  private engine: Matter.Engine;
  private previousSweepLineX: number = 0;
  private activationLineX: number = 0;
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null;
  private frameCounter: number = 0;
  private currentGroupId: number = 0;
  private currentCycleNumber: number = 0;
  private positions: number[] = [];
  private isRTL: boolean = false;
  private showParticles: boolean = true;
  private ovalBody: Matter.Composite | null = null;
  private segmentGlows: SegmentGlow[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 5,
      velocityIterations: 4,
      constraintIterations: 3
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5,
      ovalEccentricity: 0.3,
      mouthOpening: 0, // default: closed oval (no opening)
      showWaves: false // default: don't show waves
    };

    this.activationLineX = canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';

    // Initialize the oval if needed
    this.updateOval();
    

    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // Process collisions when oval is active
      if (this.params.showOval && this.ovalBody) {
        const pairs = event.pairs;
        const now = performance.now(); 
        for (const pair of pairs) {
          // We need to identify which body is the oval segment
          let segment, particleBody;
          
          if (pair.bodyA.collisionFilter.category === 0x0002) {
            segment = pair.bodyA;
            particleBody = pair.bodyB;
          } else if (pair.bodyB.collisionFilter.category === 0x0002) {
            segment = pair.bodyB;
            particleBody = pair.bodyA;
          } else {
            continue; 
          }

          // Find the actual particle object associated with this physics body
          const particleObj = this.findParticleByBody(particleBody);
          if (particleObj) {
            // Increment the collided count to mark this particle as collided
            particleObj.collided += 1;
          }

          const segmentId = segment.id;
          

          const collision = pair.collision;
          const normal = collision ? { x: collision.normal.x, y: collision.normal.y } : { x: 0, y: 0 };
          
          // Get particle velocity
          const velocity = {
            x: this.params.power * particleBody.velocity.x,
            y: particleBody.velocity.y
          };
          
          // Calculate dot product of velocity and normal for collision
          const dotProduct = velocity.x * normal.x + velocity.y * normal.y;
          
          // Take absolute value since we care about magnitude of impact, not direction
          const impactMagnitude = Math.abs(dotProduct);
          
          // Apply a threshold to filter out tiny collisions and static noise
          // Ignore collisions that don't meet the minimum threshold
          const COLLISION_THRESHOLD = 0.4;
          if (impactMagnitude < COLLISION_THRESHOLD) {
            continue; // Skip this collision as it's too small
          }
          
          // Square the dot product to emphasize stronger collisions (quadratic scaling)
          const squaredImpact = impactMagnitude * impactMagnitude;
          
          // Apply a more aggressive scaling factor for more dramatic effects
          const scaledImpact = squaredImpact * this.params.power * 5.0; 
          
          // Normalize to a higher range (0 to 3.0) for more dramatic max effects
          const normalizedIntensity = Math.min(scaledImpact, 3.0);
          
          // Check if there's already a glow for this segment
          const existingGlowIndex = this.segmentGlows.findIndex(glow => glow.segmentId === segmentId);
          
          if (existingGlowIndex >= 0) {
            // Update existing glow intensity with a higher cap (15.0 instead of 10.0)
            const existingGlow = this.segmentGlows[existingGlowIndex];
            existingGlow.intensity = Math.min(existingGlow.intensity + normalizedIntensity, 15.0);
            existingGlow.lastUpdateTime = now;
          } else {
            // Only create new glow records for significant collisions
            if (normalizedIntensity > COLLISION_THRESHOLD * 2) {
              this.segmentGlows.push({
                segmentId,
                intensity: normalizedIntensity,
                lastUpdateTime: now
              });
            }
          }
        }
      }
    });
  }

  /**
   * Calculate wave positions across the canvas height
   */
  private calculateWavePositions(canvasHeight: number): number[] {
    const positions: number[] = [];
    const compressionFactor = 0.2; // Reduced to create a more zoomed-out view
    const center = canvasHeight / 2;
    const numPositions = 15; 
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 1);
    const halfSpacing = baseSpacing / 2;

    // Add positions from top to bottom, offset from center
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2.5);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing * 1.5);
    positions.push(center - halfSpacing - baseSpacing * 1);
    positions.push(center - halfSpacing - baseSpacing * 0.5);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center);
    positions.push(center + halfSpacing + baseSpacing);
    positions.push(center + halfSpacing + baseSpacing * 0.5);
    positions.push(center + halfSpacing + baseSpacing * 1);
    positions.push(center + halfSpacing + baseSpacing * 1.5);
    positions.push(center + halfSpacing + baseSpacing * 2);
    positions.push(center + halfSpacing + baseSpacing * 2.5);
    positions.push(center + halfSpacing + baseSpacing * 3);

    return positions;
  }

  private generateBubbles(x: number): Bubble[] {
    const height = this.canvas.height;

    const bubbles: Bubble[] = [];
    const baseRadius = CanvasController.FIXED_BUBBLE_RADIUS;

    // Calculate wave positions using our helper method
    this.positions = this.calculateWavePositions(height);

    x = this.activationLineX;
    const centerY = height / 2;

    this.positions.forEach(y => {
      // Bubble radius multiplier based on the distance from center
      const normalizedPos = (y - centerY) / (height / 2);
      const radiusMultiplier = 2.5 + 4 * Math.cos(normalizedPos * Math.PI);
      const bubbleRadius = baseRadius * radiusMultiplier;
      const groupId = this.currentGroupId++;

      const particles: Particle[] = [];
      
      const particleAngles = CanvasController.PARTICLE_ANGLES;
      particleAngles.forEach((angle, idx) => {
        const particleX = x + Math.cos(angle) * bubbleRadius;
        const particleY = y + Math.sin(angle) * bubbleRadius;

        // Create physics body with size from our constant
        const body = Matter.Bodies.circle(particleX, particleY, CanvasController.PARTICLE_RADIUS, {
          friction: 0.0,        
          frictionAir: 0.0, 
          frictionStatic: 0.0,
          restitution: 1.0,
          mass:1,
          inertia: Infinity,
          slop: 0.01, 
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002, 
            group: 0   
          }
        });

        const baseSpeed = 4; 


        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * baseSpeed * 1.2,
          y: Math.sin(angle) * baseSpeed * 0.9
        });

        Matter.Composite.add(this.engine.world, body);
        // Initialize particle with energy based on the power parameter
        const particle: Particle = {
          body,
          groupId: groupId,
          cycleNumber: this.currentCycleNumber,
          index: idx,
          energy: this.params.power,
          initialEnergy: this.params.power,
          collided: 0 // Initialize with no collisions
        };
        particles.push(particle);
      });

      bubbles.push({
        x,
        y,
        radius: bubbleRadius,
        initialRadius: bubbleRadius,
        particles,
        groupId: groupId,
        cycleNumber: this.currentCycleNumber,
        energy: this.params.power,
        initialEnergy: this.params.power
      });
    });

    return bubbles;
  }

  /**
   * Updates the energy of individual particles based on their vertical velocity
   * and then recalculates the bubble's total energy as the sum of its particles
   * @param bubble The bubble to update energy for
   */
  /**
   * Finds a particle object by its Matter.js body
   * This is needed to map from physics bodies to our particle objects
   */
  private findParticleByBody(body: Matter.Body): Particle | undefined {
    // Search through all bubbles and their particles
    for (const bubble of this.bubbles) {
      for (const particle of bubble.particles) {
        if (particle.body.id === body.id) {
          return particle;
        }
      }
    }
    return undefined;
  }
  
  private updateBubbleEnergy(bubble: Bubble) {
    // Create a copy of particles for safe iteration while potentially removing some
    const particles = [...bubble.particles];
    let totalEnergy = 0;
    
    // Process each particle's energy
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      const body = particle.body;
      
      // Get the normalized vertical velocity component (absolute value)
      const verticalVelocity = Math.abs(body.velocity.y);
      
      // Calculate decay factor - higher vertical velocity means faster decay
      // This will penalize vertical motion, emphasizing horizontal waves
      const velocityFactor = 1 + (verticalVelocity * 1); // 20% penalty per unit of vertical velocity
      
      // Apply time-based decay multiplied by the velocity factor
      const decay = particle.initialEnergy * 0.001 * velocityFactor;
      particle.energy = Math.max(0, particle.energy - decay);
      
      // Accumulate energy for bubble total
      totalEnergy += particle.energy;
      
      // If particle energy is zero, remove it from physics and the bubble
      if (particle.energy <= 0) {
        // Mark for removal from the world in the next physics update
        Matter.Composite.remove(this.engine.world, body);
        
        // Remove from the bubble's particles array
        bubble.particles.splice(bubble.particles.indexOf(particle), 1);
      }
    }
    
    // Update bubble's total energy (sum of all its particles)
    bubble.energy = totalEnergy;
  }


  private renderParticle(
    ctx: CanvasRenderingContext2D,
    position: Point2D,
    opacity: number,
    particle?: Particle,
    size: number = 2.0
  ): void {
    // If we have a particle with energy data, use that to adjust opacity
    let finalOpacity = opacity * this.params.power;
    let particleSize = size;
    
    if (particle) {
      // Use particle's energy level directly
      const energyRatio = particle.energy / particle.initialEnergy;
      
      // Check if the particle has collided and choose color/size accordingly
      if (particle.collided > 0) {
        // For collided (yellow) particles: reduce opacity by 30% (requirement B)
        finalOpacity = energyRatio * 1.05; // 30% reduced brightness for yellow particles
        particleSize = size * 0.7; // 30% smaller yellow particles (requirement B)
      } else {
        // For non-collided (cyan) particles: double particle size (requirement A)
        finalOpacity = energyRatio * 2.4; // Keep similar brightness level
        particleSize = size * 2.0; // Double size for cyan particles (requirement A)
      }
    } else {
      // Use passed opacity as fallback
      finalOpacity = opacity * 0.5;
    }
    
    // Draw a filled circle for the particle
    ctx.beginPath();
    ctx.arc(position.x, position.y, particleSize, 0, Math.PI * 2);
    
    // Use yellow for particles that have collided, cyan for those that haven't
    if (particle && particle.collided > 0) {
      // Yellow color for particles that have collided (with reduced opacity)
      ctx.fillStyle = `rgba(255, 255, 0, ${finalOpacity})`;
    } else {
      // Brighter cyan color for particles that haven't collided
      ctx.fillStyle = `rgba(5, 255, 245, ${finalOpacity})`;
    }
    
    ctx.fill();
  }
  
  /**
   * Renders glowing oval segments based on collision data
   */
  private renderOvalGlow(ctx: CanvasRenderingContext2D, timestamp: number): void {
    if (!this.ovalBody || !this.params.showOval) return;
    
    // Get all segments of the oval
    const segments = Matter.Composite.allBodies(this.ovalBody);
    
    // Filter out old glows based on decay rate
    const now = timestamp;
    
    // Process each segment glow - remove glows older than 6 seconds (increased from 5)
    this.segmentGlows = this.segmentGlows.filter(glow => {
      const age = (now - glow.lastUpdateTime) / 1000;
      return age < 6; // Increased max age for longer lasting effects
    });
    
    // First draw all segments with a very faint pink fill (no borders)
    segments.forEach(segment => {
      const vertices = segment.vertices;
      
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      
      // Enhanced base glow for all segments
      ctx.fillStyle = 'rgba(255, 200, 230, 0.05)'; // Slightly more visible base color
      ctx.fill();
      // No stroke for the default state
    });
    
    // Then draw only the segments with active glows with more vibrant colors
    segments.forEach(segment => {
      // Find the glow for this segment
      const glow = this.segmentGlows.find(g => g.segmentId === segment.id);
      
      if (!glow) return; // Skip segments with no collision glow
      
      // Calculate how old this glow is in seconds
      const glowAge = (now - glow.lastUpdateTime) / 1000;
      
      // Apply smoother exponential decay to the intensity with longer persistence
      const currentIntensity = glow.intensity * Math.exp(-9 * glowAge); // Slower decay for more visible effects
      
      // Render segment with enhanced pink glow
      const vertices = segment.vertices;
      
      
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      
      const fillOpacity = currentIntensity;
      // More vibrant colors for high intensities
      const r = 255;
      const g = Math.max(20, Math.min(180, 90 + currentIntensity * 90)); // Enhanced green value range
      const b = Math.max(150, Math.min(240, 170 + currentIntensity * 70)); // Enhanced blue value range
      
      // Only use fill, no stroke for a more fluid look
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;
      ctx.fill();
      
      // Add a multi-layer outer glow for high-intensity collisions with bloom effect
       // Lower threshold to make glow appear more often
        // First layer of bloom
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        ctx.closePath();
        
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${currentIntensity})`; // Higher opacity
        ctx.fill();
        
        
        }
      
    });
  }
  
  /**
   * Draws UI elements like sweep lines and activation lines
   * Simplified version with fewer draw calls for better performance
   */
  private drawUIElements(width: number, height: number, progress: number): void {
    const timeX = width * progress;

    // Single sweep line without glow effect
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    this.ctx.lineWidth = 3; // Increased for better visibility in zoomed-out view
    this.ctx.stroke();

    // Single activation line without glow effect
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.15)";
    this.ctx.lineWidth = 2; // Increased for better visibility in zoomed-out view
    this.ctx.stroke();
  }


  public setRTL(enabled: boolean) {
    this.isRTL = enabled;
    // No need to modify physics - we'll handle this in the render phase
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  public setShowParticles(show: boolean) {
    this.showParticles = show;
    this.drawFrame(0); // Force redraw to see changes immediately
  }
  
  public setShowWaves(show: boolean) {
    this.params.showWaves = show;
    this.drawFrame(0); // Force redraw to see changes immediately
  }
  
  // Render wave lines connecting particles by cycle
  private renderWaves(ctx: CanvasRenderingContext2D): void {
    if (!this.params.showWaves) return;
    
    // Group particles by cycle number
    const particlesByCycle = new Map<number, Particle[]>();
    
    // Collect all visible particles from all bubbles
    for (const bubble of this.bubbles) {
      for (const particle of bubble.particles) {
        const cycleNumber = particle.cycleNumber;
        
        if (!particlesByCycle.has(cycleNumber)) {
          particlesByCycle.set(cycleNumber, []);
        }
        
        particlesByCycle.get(cycleNumber)?.push(particle);
      }
    }
    
    // Process each cycle's particles
    particlesByCycle.forEach((particles, cycleNumber) => {
      // Further group by collided status (0 or 1+)
      const nonCollidedParticles = particles.filter(p => p.collided === 0);
      const collidedParticles = particles.filter(p => p.collided > 0);
      
      // Sort particles by their original index to maintain the creation order
      nonCollidedParticles.sort((a, b) => a.index - b.index);
      collidedParticles.sort((a, b) => a.index - b.index);
      
      // Draw connecting lines for non-collided particles (blue)
      if (nonCollidedParticles.length > 1) {
        // Each segment will be drawn individually to calculate its length for opacity scaling
        for (let i = 1; i < nonCollidedParticles.length; i++) {
          const prevParticle = nonCollidedParticles[i-1];
          const particle = nonCollidedParticles[i];
          
          // Calculate segment length for opacity scaling
          const dx = particle.body.position.x - prevParticle.body.position.x;
          const dy = particle.body.position.y - prevParticle.body.position.y;
          const segmentLength = Math.sqrt(dx * dx + dy * dy);
          
          // Calculate opacity based on segment length (inversely proportional)
          // We'll use a max length of 100 pixels for reference (shorter = more opaque)
          const maxReferenceLength = 100;
          // Scale factor inversely proportional to length (bounded between 0.2 and 1.0)
          const scaleFactor = Math.max(0.2, Math.min(1.0, maxReferenceLength / (segmentLength + 20)));
          
          // Double opacity for non-collided lines (requirement A)
          const baseOpacity = 0.6 * 2.0;
          const lineOpacity = baseOpacity * scaleFactor;
          
          ctx.beginPath();
          ctx.moveTo(prevParticle.body.position.x, prevParticle.body.position.y);
          ctx.lineTo(particle.body.position.x, particle.body.position.y);
          
          ctx.strokeStyle = `rgba(0, 170, 255, ${lineOpacity})`; // Blue line with scaled opacity
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      
      // Draw connecting lines for collided particles (yellow)
      if (collidedParticles.length > 1) {
        // Each segment will be drawn individually to calculate its length for opacity scaling
        for (let i = 1; i < collidedParticles.length; i++) {
          const prevParticle = collidedParticles[i-1];
          const particle = collidedParticles[i];
          
          // Calculate segment length for opacity scaling
          const dx = particle.body.position.x - prevParticle.body.position.x;
          const dy = particle.body.position.y - prevParticle.body.position.y;
          const segmentLength = Math.sqrt(dx * dx + dy * dy);
          
          // Calculate opacity based on segment length (inversely proportional)
          // We'll use a max length of 100 pixels for reference (shorter = more opaque)
          const maxReferenceLength = 100;
          // Scale factor inversely proportional to length (bounded between 0.2 and 1.0)
          const scaleFactor = Math.max(0.2, Math.min(1.0, maxReferenceLength / (segmentLength + 20)));
          
          // Reduce base opacity by 30% for collided (yellow) lines (requirement B)
          const baseOpacity = 0.6 * 0.7;
          const lineOpacity = baseOpacity * scaleFactor;
          
          ctx.beginPath();
          ctx.moveTo(prevParticle.body.position.x, prevParticle.body.position.y);
          ctx.lineTo(particle.body.position.x, particle.body.position.y);
          
          ctx.strokeStyle = `rgba(255, 200, 0, ${lineOpacity})`; // Yellow line with scaled opacity
          // Reduce line thickness by 30% for collided lines (requirement B)
          ctx.lineWidth = 1.5 * 0.7;
          ctx.stroke();
        }
      }
    });
  }

  public updateParams(params: AnimationParams) {
    const prevShowOval = this.params.showOval;
    const prevPosition = this.params.ovalPosition;
    const prevEccentricity = this.params.ovalEccentricity;
    const prevMouthOpening = this.params.mouthOpening;

    this.params = params;

    // Check if oval-related parameters have changed
    const ovalChanged = prevShowOval !== params.showOval || 
                        prevPosition !== params.ovalPosition || 
                        prevEccentricity !== params.ovalEccentricity ||
                        prevMouthOpening !== params.mouthOpening;

    if (ovalChanged) {
      // Check which specific parameters changed
      const eccentricityChanged = prevEccentricity !== params.ovalEccentricity;
      const mouthOpeningChanged = prevMouthOpening !== params.mouthOpening;

      // If we need to create a new oval, delete the old one first
      // We recreate the oval if eccentricity or mouth opening changed or if the oval visibility changed
      if (this.ovalBody && (eccentricityChanged || mouthOpeningChanged || prevShowOval !== params.showOval)) {
        Matter.Composite.remove(this.engine.world, this.ovalBody);
        this.ovalBody = null;
      }

      this.updateOval();
    }

    // Redraw the frame if parameters changed and animation is not running
    if (ovalChanged && this.animationFrame === null) {
      this.drawFrame(0);
    }
  }

  /**
   * Creates a new oval composite
   * Separated from updateOval for better code organization
   */
  private createOvalBody(
    centerX: number,
    centerY: number,
    majorAxis: number,
    minorAxis: number
  ): Matter.Composite {
    const wallThickness = 18;
    const ovalBody = Matter.Composite.create();
    const segments = 68;

    // Calculate the mouth opening angle based on mouthOpening parameter
    // When mouthOpening is 0, there's no opening
    // When mouthOpening is 1, half of the oval is open (PI radians)
    // The opening should be symmetrical around the horizontal axis
    const mouthAngle = Math.PI * this.params.mouthOpening;
    
    for (let i = 0; i < segments; i++) {
      // Calculate current angle and next angle
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;

      // Normalize angle to [0, 2π)
      const normalizedAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      
      // Check if this segment should be skipped (part of the mouth opening)
      let inMouthRegion;
      
      // The mouth opening should be symmetrical across the horizontal axis
      if (this.isRTL) {
        // For RTL, the opening is on the left side (π radians)
        
        // Calculate how far we are from the left horizontal line (π radians)
        // We need to consider the angle either above or below the horizontal line
        // For angles in the left half of the circle, we need the smaller angle to the horizontal
        const angleFromLeftHorizontal = Math.abs(normalizedAngle - Math.PI);
        
        // The mouth should be centered on the left side (π radians) 
        // and symmetrical up and down (from 3π/2 to π/2, going clockwise)
        inMouthRegion = (angleFromLeftHorizontal <= mouthAngle/2) && 
                        // This ensures we're on the left side of the oval
                        (normalizedAngle > Math.PI/2 && normalizedAngle < Math.PI * 3/2);
      } else {
        // For LTR, the opening is on the right side (0 or 2π radians)
        
        // For angles near 0 or 2π (right horizontal), get the smaller angle to the axis
        // For angles close to 0, it's just the angle itself
        // For angles close to 2π, it's 2π - angle
        const angleFromRightHorizontal = normalizedAngle <= Math.PI 
                                       ? normalizedAngle 
                                       : 2 * Math.PI - normalizedAngle;
        
        // The mouth should be centered on the right side (0 radians)
        // and symmetrical up and down (from π/2 to 3π/2, going counterclockwise) 
        inMouthRegion = (angleFromRightHorizontal <= mouthAngle/2) && 
                        // This ensures we're on the right side of the oval
                        (normalizedAngle < Math.PI/2 || normalizedAngle > Math.PI * 3/2);
      }

      // Skip this segment if it's part of the mouth opening
      if (inMouthRegion) continue;

      // Calculate current position on the ellipse
      const x1 = centerX + (majorAxis / 2) * Math.cos(angle);
      const y1 = centerY + (minorAxis / 2) * Math.sin(angle);

      // Calculate next position on the ellipse
      const x2 = centerX + (majorAxis / 2) * Math.cos(nextAngle);
      const y2 = centerY + (minorAxis / 2) * Math.sin(nextAngle);

      // Calculate midpoint and length of segment
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const segmentLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

      // Calculate angle of the segment
      const segmentAngle = Math.atan2(y2 - y1, x2 - x1);

      const segment = Matter.Bodies.rectangle(midX, midY, segmentLength, wallThickness, {
        isStatic: true,
        angle: segmentAngle,
        restitution: 1.0,
        friction: 0.0,
        frictionAir: 0,
        frictionStatic: 0.0,
        slop: 0.005,  
        collisionFilter: {
          category: 0x0002,
          mask: 0x0001,
          group: 0
        }
      });

      // Add the segment to our composite
      Matter.Composite.add(ovalBody, segment);
    }

    return ovalBody;
  }

  private updateOval() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const newCenterX = width * this.params.ovalPosition;
    const centerY = height / 2; 
    const majorAxis = width * 0.5; // Reduced size for zoomed-out view
    const minorAxis = majorAxis * (1 - this.params.ovalEccentricity * 0.8);
    
    if (!this.params.showOval) {
      if (this.ovalBody) {
        Matter.Composite.remove(this.engine.world, this.ovalBody);
        this.ovalBody = null;
      }
      return;
    }

    // If oval body doesn't exist yet or eccentricity changed, create a new one
    if (!this.ovalBody) {
      // Create and add a new oval
      this.ovalBody = this.createOvalBody(newCenterX, centerY, majorAxis, minorAxis);
      Matter.Composite.add(this.engine.world, this.ovalBody);
      return;
    }

    // If only the position changed, we can just translate the existing oval
    const bodies = Matter.Composite.allBodies(this.ovalBody);
    if (bodies.length > 0) {
      // Calculate the center of the current oval by averaging all body positions
      let totalX = 0;
      bodies.forEach(body => {
        totalX += body.position.x;
      });
      const currentCenterX = totalX / bodies.length;

      // Calculate the translation vector
      const dx = newCenterX - currentCenterX;

      // Check if position actually changed and eccentricity is the same
      if (Math.abs(dx) > 0.1) {
        // Translate all bodies in the oval composite
        Matter.Composite.translate(this.ovalBody, { x: dx, y: 0 });
      }
    } 
    else {
      // If somehow the oval is empty, create a new one
      Matter.Composite.remove(this.engine.world, this.ovalBody);
      this.ovalBody = this.createOvalBody(newCenterX, centerY, majorAxis, minorAxis);
      Matter.Composite.add(this.engine.world, this.ovalBody);
    }
  }

  public play() {
    if (this.animationFrame !== null) return;
    this.startTime = performance.now();
    this.animate();
  }

  public pause() {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.startTime = null;
  }

  public cleanup() {
    this.pause();
    Matter.Engine.clear(this.engine);
    Matter.World.clear(this.engine.world, false);
  }

  private drawFrame(progress: number) {
    // Define width and height variables that can be used throughout this method
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Apply RTL transformation if enabled
    this.ctx.save();
    if (this.isRTL) {
      // Flip the canvas horizontally for RTL mode
      this.ctx.scale(-1, 1);
      this.ctx.translate(-width, 0);
    }

    // Reduce motion blur effect to make particles stay visible longer
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.1)'; 
    this.ctx.fillRect(0, 0, width, height);

    // =====================================
    // Step 1: Draw UI elements (sweep lines, activation lines)
    // =====================================
    this.drawUIElements(width, height, progress);

    // =====================================
    // Step 2: Handle particle spawning at activation line
    // =====================================
    const timeX = width * progress;

    // Check if the sweep line has crossed the activation line (left to right only)
    const hasPassedActivationLine = 
      (this.previousSweepLineX < this.activationLineX && timeX >= this.activationLineX);

    // Activation line spawning - create blue particles when sweep line crosses activation line
    if (hasPassedActivationLine) {
      const newBubbles = this.generateBubbles(this.activationLineX);
      this.bubbles.push(...newBubbles);
    }

    // Update previous position for next frame
    this.previousSweepLineX = timeX;

    // =====================================
    // Step 3: Define screen bounds for physics and rendering optimization
    // =====================================
    const bufferMargin = 10;
    const screenBounds = {
      min: { x: -bufferMargin, y: -bufferMargin },
      max: { x: width + bufferMargin, y: height + bufferMargin }
    };

    // Update and draw bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      // Optimize physics by only processing particles within or near the canvas
      if (bubble.particles.length > 0) {
        bubble.particles.forEach(particle => {
          const pos = particle.body.position;
          const isOnScreen = 
            pos.x >= screenBounds.min.x && 
            pos.x <= screenBounds.max.x && 
            pos.y >= screenBounds.min.y && 
            pos.y <= screenBounds.max.y;

          // Only process physics for on-screen particles
          if (isOnScreen) {
            // Enable collisions for on-screen particles
            const collisionFilter = {
              category: 0x0001,
              mask: 0x0002, // Only collide with the oval (0x0002), not other particles
              group: 0 // Using standard group to rely on mask
            };
            Matter.Body.set(particle.body, 'collisionFilter', collisionFilter);
            // Keep normal physics simulation for on-screen particles
            Matter.Body.setStatic(particle.body, false);
          } else {
            // Disable collisions for off-screen particles to save computation
            const collisionFilter = {
              category: 0x0000,
              mask: 0x0000, // Don't collide with anything
              group: 0 // Don't allow collision with other particles
            };
            Matter.Body.set(particle.body, 'collisionFilter', collisionFilter);
            // Make off-screen particles static to further reduce computation
            Matter.Body.setStatic(particle.body, true);
          }
        });
      }

      if (bubble.particles.length > 0) {
        // Use energy for opacity control
        let opacity = bubble.energy / bubble.initialEnergy;

        // Skip rendering if no energy left
        if (opacity <= 0) {
          return true; 
        }

        if (bubble.particles.length > 3) {
          // Get visible particles for rendering
          const visibleParticles = bubble.particles.filter(p => {
            const pos = p.body.position;
            return pos.x >= 0 && pos.x <= this.canvas.width && 
                   pos.y >= 0 && pos.y <= this.canvas.height;
          });

          // Draw individual particles if enabled
          if (this.showParticles) {
            visibleParticles.forEach(particle => {
              const pos = particle.body.position;
              // Pass the particle object to use its energy for rendering
              this.renderParticle(this.ctx, pos, opacity, particle);
            });
          }
        }
      }

      // Check if the bubble has expired based on its cycle number
      if (this.currentCycleNumber - bubble.cycleNumber > CanvasController.PARTICLE_LIFETIME_CYCLES) {
        if (bubble.particles.length > 0) {
          bubble.particles.forEach(particle => {
            Matter.Composite.remove(this.engine.world, particle.body);
          });
        }
        return false;
      }
      return true;
    });

    // Draw the oval if it exists and is supposed to be shown
    if (this.params.showOval && this.ovalBody) {
      // Always render the glow effect on oval segments
      this.renderOvalGlow(this.ctx, performance.now());
    }
    
    // Render wave visualization if enabled
    if (this.params.showWaves) {
      this.renderWaves(this.ctx);
    }

    // Restore canvas state (important for RTL transformation)
    this.ctx.restore();
  }

  private animate() {
    if (!this.startTime) return;

    // Calculate time elapsed since last frame
    const elapsed = performance.now() - this.startTime;
    const cyclePeriod = CanvasController.CYCLE_PERIOD_MS;
    const currentCycleTime = Math.floor(elapsed / cyclePeriod);

    // Increment Cycles
    if (currentCycleTime > this.lastCycleTime) {
      this.lastCycleTime = currentCycleTime;
      this.currentCycleNumber++;
      console.log(`Starting cycle ${this.currentCycleNumber}`);

      // Kill bubbles and their particles if they're too old or no longer in a bubble
      const activeBodies = new Set(this.bubbles.flatMap(b => b.particles.map(p => p.body)));
      Matter.Composite.allBodies(this.engine.world).forEach(body => {
        // Skip walls and other static bodies
        if (body.isStatic) return;

        // If the body is not in active bubbles, remove it from the world
        if (!activeBodies.has(body)) {
          Matter.Composite.remove(this.engine.world, body);
        }
      });

      // Call the cycle start callback if it exists
      if (this.onCycleStart) {
        this.onCycleStart();
      }
    }

    // Get normalized progress through current cycle (0 to 1)
    const progress = (elapsed % cyclePeriod) / cyclePeriod;

    // Always update physics
    this.updatePhysics(elapsed);

    // Render only every other frame to improve performance
    this.frameCounter++;
    if (this.frameCounter % 2 === 0) {
      this.drawFrame(progress);
    }

    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  private updatePhysics(timestamp: number) {
    // Use fixed timestep for more consistent physics
    const fixedDeltaTime = CanvasController.PHYSICS_TIMESTEP_MS;

    // Use a variable number of substeps based on whether oval is shown
    const numSubSteps = this.params.showOval ? 5 : 3; // Doubled substeps: 8 when oval present, 4 when not
    const subStepTime = fixedDeltaTime / numSubSteps;

    // Perform physics updates in substeps for better stability
    // No need to reset friction values every update as they're set during body creation
    for (let i = 0; i < numSubSteps; i++) {
      // Use fixed time step for more consistent physics
      Matter.Engine.update(this.engine, subStepTime);
    }

    // Update bubble energies
    this.bubbles.forEach(bubble => this.updateBubbleEnergy(bubble));
  }
}