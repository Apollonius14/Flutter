import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; 
  ovalEccentricity: number;
  mouthOpening: number;  // 0 = closed oval, 1 = half oval (maximum opening)
  showWaves: boolean;    // Whether to show the wave visualization
  showSmooth: boolean;   // Whether to use smooth bezier curves for wave visualization
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
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.3;  
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 2;
  private static readonly PHYSICS_TIMESTEP_MS: number = 10; 
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; 
  private static readonly PARTICLES_PER_RING: number = 78;
  private static readonly PARTICLE_RADIUS: number = 2.0;
  private static readonly FIXED_BUBBLE_RADIUS: number = 4.0; 
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
      ovalEccentricity: 0.6,
      mouthOpening: 0, // default: closed oval (no opening)
      showWaves: false, // default: don't show waves
      showSmooth: false // default: don't use smooth bezier curves
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

        const baseSpeed = 9; 


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
      const velocityFactor = 0.5 + (verticalVelocity * 2); // 20% penalty per unit of vertical velocity
      
      // Apply time-based decay multiplied by the velocity factor
      const decay = particle.initialEnergy * 0.001 * 0.5 * velocityFactor;
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
    size: number = CanvasController.PARTICLE_RADIUS * 10
  ): void {
    // If we have a particle with energy data, use that to adjust opacity
    let finalOpacity = opacity * this.params.power * 0.5;
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
      // Dimmer color for particles that have collided (with reduced opacity)
      ctx.fillStyle = `rgba(5, 255, 245, ${finalOpacity}*0.7)`;
    } else {
      // Brighter cyan color for particles that haven't collided
      ctx.fillStyle = `rgba(5, 255, 245, ${finalOpacity})`;
    }
    
    ctx.fill();
  }
  
  /**
   * Updates glow data for oval segments
   */
  private renderOvalGlow(ctx: CanvasRenderingContext2D, timestamp: number): void {
    if (!this.ovalBody || !this.params.showOval) return;
    
    // Filter out old glows based on decay rate
    const now = timestamp;
    
    // Process each segment glow - remove glows older than 3 seconds
    this.segmentGlows = this.segmentGlows.filter(glow => {
      const age = (now - glow.lastUpdateTime) / 1000;
      return age < 3; // Keep glows less than 3 seconds old
    });
  
    // Apply decay to all glows
    for (const glow of this.segmentGlows) {
      const age = (now - glow.lastUpdateTime) / 1000;
      
      // Apply exponential decay
      const decayFactor = Math.pow(0.75, age * 2);
      
      // Update the intensity with our decay
      glow.intensity *= decayFactor;
    }
    
    // Remove glows that have faded below threshold
    this.segmentGlows = this.segmentGlows.filter(glow => glow.intensity > 0.05);
  }
  
  /**
   * Draws UI elements like sweep lines and activation lines
   * Simplified version with fewer draw calls for better performance
   */
  private drawUIElements(width: number, height: number, progress: number): void {
    const ctx = this.ctx;
    
    // Calculate new sweep line position
    const sweepPosition = width * (0.05 + progress * 0.9);
    this.previousSweepLineX = sweepPosition;
    
    // Draw activation line
    ctx.strokeStyle = "#353583";
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    ctx.moveTo(this.activationLineX, 0);
    ctx.lineTo(this.activationLineX, height); 
    ctx.stroke();
    
    // Draw sweep line with a subtle gradient
    const gradient = ctx.createLinearGradient(sweepPosition - 10, 0, sweepPosition + 10, 0);
    gradient.addColorStop(0, "rgba(51, 153, 255, 0)");  
    gradient.addColorStop(0.5, "rgba(51, 153, 255, 0.6)"); 
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    
    ctx.beginPath();  
    ctx.moveTo(sweepPosition, 0);
    ctx.lineTo(sweepPosition, height);
    ctx.stroke();
  }

  
  public setRTL(enabled: boolean) {
    this.isRTL = enabled;
    // Rebuild the oval with the new RTL status
    if (this.params.showOval) {
      this.updateOval();
    }
  }
  
  public setShowParticles(show: boolean) {
    this.showParticles = show;
  }
  
  public setShowWaves(show: boolean) {
    this.params.showWaves = show;
  }
  
  public setShowSmooth(show: boolean) {
    this.params.showSmooth = show;
  }
  
  private renderWaves(ctx: CanvasRenderingContext2D): void {
    // Group particles by cycleNumber
    const cycleGroups = new Map<number, Particle[]>();
    
    for (const bubble of this.bubbles) {
      const cycle = bubble.cycleNumber;
      
      if (!cycleGroups.has(cycle)) {
        cycleGroups.set(cycle, []);
      }
      
      for (const particle of bubble.particles) {
        cycleGroups.get(cycle)?.push(particle);
      }
    }
    
    // Render each cycle's particles
    cycleGroups.forEach(particles => {
      // Group by groupId (bubble)
      const bubbleGroups = new Map<number, Particle[]>();
      
      for (const particle of particles) {
        const group = particle.groupId;
        
        if (!bubbleGroups.has(group)) {
          bubbleGroups.set(group, []);
        }
        
        bubbleGroups.get(group)?.push(particle);
      }
      
      // Render each bubble's particles as a wave
      bubbleGroups.forEach(bubbleParticles => {
        // Sort by index to maintain the same order
        bubbleParticles.sort((a, b) => a.index - b.index);
        
        // Split particles into collided and uncollided 
        const collidedParticles = bubbleParticles.filter(p => p.collided > 0);
        const nonCollidedParticles = bubbleParticles.filter(p => p.collided === 0);
        
        // Draw non-collided (cyan) wave lines first
        if (nonCollidedParticles.length >= 2) {
          ctx.strokeStyle = "rgba(5, 255, 245, 0.6)"; // Light cyan
          ctx.lineWidth = 9.5;
          ctx.beginPath();
          
          let prev: Particle | null = null;
          
          for (const particle of nonCollidedParticles) {
            if (prev) {
              // Only connect if x-distance is not too far
              const dx = Math.abs(particle.body.position.x - prev.body.position.x);
              if (dx < 10) { // Threshold to avoid connecting distant particles
                ctx.moveTo(prev.body.position.x, prev.body.position.y);
                ctx.lineTo(particle.body.position.x, particle.body.position.y);
              }
            }
            prev = particle;
          }
          
          ctx.stroke();
        }
        
        // Draw collided (yellow) wave lines
        if (collidedParticles.length >= 2) {
          ctx.strokeStyle = "rgba(255, 255, 120, 0.45)"; // Yellow
          ctx.lineWidth = 7
          ctx.beginPath();
          
          let prev: Particle | null = null;
          
          for (const particle of collidedParticles) {
            if (prev) {
              // Only connect if x-distance is not too far
              const dx = Math.abs(particle.body.position.x - prev.body.position.x);
              if (dx < 10) { // Threshold to avoid connecting distant particles
                ctx.moveTo(prev.body.position.x, prev.body.position.y);
                ctx.lineTo(particle.body.position.x, particle.body.position.y);
              }
            }
            prev = particle;
          }
          
          ctx.stroke();
        }
      });
    });
  }
  
  private renderSmoothWaves(
    ctx: CanvasRenderingContext2D,
    nonCollidedParticles: Particle[],
    collidedParticles: Particle[]
  ): void {
    // Helper function to group particles by direction angle
    const groupParticlesByDirection = (particles: Particle[]) => {
      const buckets = new Map<number, Particle[]>();
      const bucketSize = 5; // Increased from 5 to 10 degrees for smoother curves
      
      for (const particle of particles) {
        // Calculate direction of particle's motion
        const velocity = particle.body.velocity;
        const angle = Math.atan2(velocity.y, velocity.x) * 180 / Math.PI;
        
        // Round to nearest bucketSize degrees
        const bucketAngle = Math.round(angle / bucketSize) * bucketSize;
        
        if (!buckets.has(bucketAngle)) {
          buckets.set(bucketAngle, []);
        }
        
        buckets.get(bucketAngle)?.push(particle);
      }
      
      return buckets;
    };
    
    // Function to calculate the direction angle of a particle
    const getDirectionAngle = (particle: Particle): number => {
      const vel = particle.body.velocity;
      return Math.atan2(vel.y, vel.x);
    };
    
    // Function to calculate centroid of a group of particles
    const calculateCentroid = (particles: Particle[]): Point2D => {
      if (particles.length === 0) return { x: 0, y: 0 };
      
      let sumX = 0;
      let sumY = 0;
      
      for (const particle of particles) {
        sumX += particle.body.position.x;
        sumY += particle.body.position.y;
      }
      
      return {
        x: sumX / particles.length,
        y: sumY / particles.length
      };
    };
    
    // Draw smooth curves for non-collided particles (more prominent)
    if (nonCollidedParticles.length > 5) { // Need enough particles for meaningful curve
      const buckets = groupParticlesByDirection(nonCollidedParticles);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket), // Convert string key to number
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(5, 255, 245, 0.95)"; // Brighter cyan
        ctx.lineWidth = 20;
        
        const startPoint = centroids[0];
        ctx.moveTo(startPoint.x, startPoint.y);
        
        // Linear blending constraint factor - controls how much the curve can deviate
        const influenceFactor = 0.3; // Lower values = less curve deviation
        
        // Use constrained quadratic curves through centroids
        for (let i = 1; i < centroids.length - 2; i++) {
          const c1 = centroids[i];
          const c2 = centroids[i + 1];
          
          // Use the midpoint between current and next as the bezier end
          const endX = (c1.x + c2.x) / 2;
          const endY = (c1.y + c2.y) / 2;
          
          // Apply linear blending constraint to control point
          // This pulls the control point closer to the line between adjacent midpoints
          // reducing the "pull" effect that causes wild deviations
          const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
          const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
          
          // Calculate the midpoint of the line segment (this is our reference line)
          const midX = (prevX + endX) / 2;
          const midY = (prevY + endY) / 2;
          
          // Apply linear blending constraint - limit control point deviation
          const controlX = midX + influenceFactor * (c1.x - midX);
          const controlY = midY + influenceFactor * (c1.y - midY);
          
          // Use the constrained control point
          ctx.quadraticCurveTo(controlX, controlY, endX, endY);
        }
        
        // Add the final segment if we have enough points
        if (centroids.length >= 3) {
          const last = centroids.length - 1;
          const secondLast = centroids.length - 2;
          
          // Apply same constraint to final segment
          const prevEndX = (centroids[secondLast-1].x + centroids[secondLast].x) / 2;
          const prevEndY = (centroids[secondLast-1].y + centroids[secondLast].y) / 2;
          const lastX = centroids[last].x;
          const lastY = centroids[last].y;
          
          // Reference midpoint
          const midX = (prevEndX + lastX) / 2;
          const midY = (prevEndY + lastY) / 2;
          
          // Constrained control point
          const controlX = midX + influenceFactor * (centroids[secondLast].x - midX);
          const controlY = midY + influenceFactor * (centroids[secondLast].y - midY);
          
          ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
        }
        
        ctx.stroke();
      }
    }
    
    // Draw smooth curves for collided particles (less prominent)
    if (collidedParticles.length > 5) {
      const buckets = groupParticlesByDirection(collidedParticles);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket), // Convert string key to number
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 120, 0.55)"; // Yellow but less bright
        ctx.lineWidth = 15.5;
        
        const startPoint = centroids[0];
        ctx.moveTo(startPoint.x, startPoint.y);
        
        // Linear blending constraint factor - controls how much the curve can deviate
        // Slightly higher for collided particles to allow more deviation
        const influenceFactor = 0.35; // Lower values = less curve deviation
        
        // Use constrained quadratic curves through centroids
        for (let i = 1; i < centroids.length - 2; i++) {
          const c1 = centroids[i];
          const c2 = centroids[i + 1];
          
          // Use the midpoint between current and next as the bezier end
          const endX = (c1.x + c2.x) / 2;
          const endY = (c1.y + c2.y) / 2;
          
          // Apply linear blending constraint to control point
          // This pulls the control point closer to the line between adjacent midpoints
          // reducing the "pull" effect that causes wild deviations
          const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
          const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
          
          // Calculate the midpoint of the line segment (this is our reference line)
          const midX = (prevX + endX) / 2;
          const midY = (prevY + endY) / 2;
          
          // Apply linear blending constraint - limit control point deviation
          const controlX = midX + influenceFactor * (c1.x - midX);
          const controlY = midY + influenceFactor * (c1.y - midY);
          
          // Use the constrained control point
          ctx.quadraticCurveTo(controlX, controlY, endX, endY);
        }
        
        // Add the final segment if we have enough points
        if (centroids.length >= 3) {
          const last = centroids.length - 1;
          const secondLast = centroids.length - 2;
          
          // Apply same constraint to final segment
          const prevEndX = (centroids[secondLast-1].x + centroids[secondLast].x) / 2;
          const prevEndY = (centroids[secondLast-1].y + centroids[secondLast].y) / 2;
          const lastX = centroids[last].x;
          const lastY = centroids[last].y;
          
          // Reference midpoint
          const midX = (prevEndX + lastX) / 2;
          const midY = (prevEndY + lastY) / 2;
          
          // Constrained control point
          const controlX = midX + influenceFactor * (centroids[secondLast].x - midX);
          const controlY = midY + influenceFactor * (centroids[secondLast].y - midY);
          
          ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
        }
        
        ctx.stroke();
      }
    }
  }
  
  /**
   * Enhanced renderSmoothWaves that groups particles by cycle number first
   * This preserves visual coherence by keeping particles from the same generation together
   * 
   * @param ctx Canvas rendering context
   * @param nonCollidedParticles Array of particles that have never collided with the oval
   * @param collidedParticles Array of particles that have collided with the oval at least once
   */
  private renderSmoothWavesByCycle(
    ctx: CanvasRenderingContext2D,
    nonCollidedParticles: Particle[],
    collidedParticles: Particle[]
  ): void {
    // Helper function to group particles by direction angle
    const groupParticlesByDirection = (particles: Particle[]) => {
      const buckets = new Map<string, Particle[]>();
      const ANGLE_BUCKETS = 72; // Number of angle buckets (10 degrees each)
      
      for (const particle of particles) {
        const body = particle.body;
        const velocity = body.velocity;
        
        // Calculate angle of movement (in radians)
        const angle = Math.atan2(velocity.y, velocity.x);
        
        // Normalize to 0-360 degrees and split into buckets
        const degrees = ((angle * 180 / Math.PI) + 360) % 360;
        const bucketIndex = Math.floor(degrees / (360 / ANGLE_BUCKETS));
        
        const key = bucketIndex.toString();
        if (!buckets.has(key)) {
          buckets.set(key, []);
        }
        buckets.get(key)!.push(particle);
      }
      
      return buckets;
    };
    
    // Helper to calculate centroid (average position) of a group of particles
    const calculateCentroid = (particles: Particle[]): Point2D => {
      let sumX = 0;
      let sumY = 0;
      
      for (const particle of particles) {
        const position = particle.body.position;
        sumX += position.x;
        sumY += position.y;
      }
      
      return {
        x: sumX / particles.length,
        y: sumY / particles.length
      };
    };
    
    // NEW STEP: First group all particles by cycle number
    const nonCollidedByCycle = new Map<number, Particle[]>();
    const collidedByCycle = new Map<number, Particle[]>();
    
    // Group non-collided particles by cycle
    for (const particle of nonCollidedParticles) {
      const cycleNum = particle.cycleNumber;
      if (!nonCollidedByCycle.has(cycleNum)) {
        nonCollidedByCycle.set(cycleNum, []);
      }
      nonCollidedByCycle.get(cycleNum)!.push(particle);
    }
    
    // Group collided particles by cycle
    for (const particle of collidedParticles) {
      const cycleNum = particle.cycleNumber;
      if (!collidedByCycle.has(cycleNum)) {
        collidedByCycle.set(cycleNum, []);
      }
      collidedByCycle.get(cycleNum)!.push(particle);
    }
    
    // Draw smooth curves for non-collided particles, grouped by cycle
    // Convert Map iterator to array to avoid downlevelIteration issues
    for (const [cycleNum, particlesInCycle] of Array.from(nonCollidedByCycle.entries())) {
      if (particlesInCycle.length > 5) { // Need enough particles for meaningful curve
        const buckets = groupParticlesByDirection(particlesInCycle);
        const centroids: Point2D[] = [];
        
        // Extract and sort centroids by angle bucket
        Array.from(buckets.entries())
          .map(([angleBucket, particles]) => {
            return {
              angleBucket: Number(angleBucket), // Convert string key to number
              centroid: calculateCentroid(particles),
              count: particles.length
            };
          })
          .filter(item => item.count >= 2) // Only use buckets with multiple particles
          .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
          .forEach(item => centroids.push(item.centroid));
        
        // Draw bezier curve through centroids if we have enough points
        if (centroids.length >= 4) {
          // Calculate line width based on particle count (proportional to square of particle count)
          const particleCount = particlesInCycle.length;
          const baseThickness = 3.5;
          const maxThickness = 15;
          // Square function with scaling to keep reasonable thickness range
          const scaledThickness = Math.min(maxThickness, baseThickness * Math.pow(particleCount / 30, 2));
          
          ctx.beginPath();
          ctx.strokeStyle = "rgba(0, 255, 255, 1.0)"; // Brilliant cyan
          ctx.lineWidth = scaledThickness;
          
          const startPoint = centroids[0];
          ctx.moveTo(startPoint.x, startPoint.y);
          
          // Linear blending constraint factor - controls how much the curve can deviate
          const influenceFactor = 0.3; // Lower values = less curve deviation
          
          // Use constrained quadratic curves through centroids
          for (let i = 1; i < centroids.length - 2; i++) {
            const c1 = centroids[i];
            const c2 = centroids[i + 1];
            
            // Use the midpoint between current and next as the bezier end
            const endX = (c1.x + c2.x) / 2;
            const endY = (c1.y + c2.y) / 2;
            
            // Apply linear blending constraint to control point
            // This pulls the control point closer to the line between adjacent midpoints
            // reducing the "pull" effect that causes wild deviations
            const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
            const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
            
            // Calculate the midpoint of the line segment (this is our reference line)
            const midX = (prevX + endX) / 2;
            const midY = (prevY + endY) / 2;
            
            // Apply linear blending constraint - limit control point deviation
            const controlX = midX + influenceFactor * (c1.x - midX);
            const controlY = midY + influenceFactor * (c1.y - midY);
            
            // Use the constrained control point
            ctx.quadraticCurveTo(controlX, controlY, endX, endY);
          }
          
          // Add the final segment if we have enough points
          if (centroids.length >= 3) {
            const last = centroids.length - 1;
            const secondLast = centroids.length - 2;
            
            // Apply same constraint to final segment
            const prevEndX = (centroids[secondLast-1].x + centroids[secondLast].x) / 2;
            const prevEndY = (centroids[secondLast-1].y + centroids[secondLast].y) / 2;
            const lastX = centroids[last].x;
            const lastY = centroids[last].y;
            
            // Reference midpoint
            const midX = (prevEndX + lastX) / 2;
            const midY = (prevEndY + lastY) / 2;
            
            // Constrained control point
            const controlX = midX + influenceFactor * (centroids[secondLast].x - midX);
            const controlY = midY + influenceFactor * (centroids[secondLast].y - midY);
            
            ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
          }
          
          ctx.stroke();
        }
      }
    }
    
    // Draw smooth curves for collided particles, grouped by cycle
    // Convert Map iterator to array to avoid downlevelIteration issues
    for (const [cycleNum, particlesInCycle] of Array.from(collidedByCycle.entries())) {
      if (particlesInCycle.length > 5) {
        const buckets = groupParticlesByDirection(particlesInCycle);
        const centroids: Point2D[] = [];
        
        // Extract and sort centroids by angle bucket
        Array.from(buckets.entries())
          .map(([angleBucket, particles]) => {
            return {
              angleBucket: Number(angleBucket), // Convert string key to number
              centroid: calculateCentroid(particles),
              count: particles.length
            };
          })
          .filter(item => item.count >= 2) // Only use buckets with multiple particles
          .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
          .forEach(item => centroids.push(item.centroid));
        
        // Draw bezier curve through centroids if we have enough points
        if (centroids.length >= 4) {
          // Calculate line width based on particle count (proportional to square of particle count)
          const particleCount = particlesInCycle.length;
          const baseThickness = 3.0;
          const maxThickness = 12;
          // Square function with scaling to keep reasonable thickness range
          const scaledThickness = Math.min(maxThickness, baseThickness * Math.pow(particleCount / 25, 2));
          
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255, 215, 0, 1.0)"; // Golden yellow
          ctx.lineWidth = scaledThickness;
          
          const startPoint = centroids[0];
          ctx.moveTo(startPoint.x, startPoint.y);
          
          // Linear blending constraint factor - controls how much the curve can deviate
          // Slightly higher for collided particles to allow more deviation
          const influenceFactor = 0.35; // Lower values = less curve deviation
          
          // Use constrained quadratic curves through centroids
          for (let i = 1; i < centroids.length - 2; i++) {
            const c1 = centroids[i];
            const c2 = centroids[i + 1];
            
            // Use the midpoint between current and next as the bezier end
            const endX = (c1.x + c2.x) / 2;
            const endY = (c1.y + c2.y) / 2;
            
            // Apply linear blending constraint to control point
            // This pulls the control point closer to the line between adjacent midpoints
            // reducing the "pull" effect that causes wild deviations
            const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
            const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
            
            // Calculate the midpoint of the line segment (this is our reference line)
            const midX = (prevX + endX) / 2;
            const midY = (prevY + endY) / 2;
            
            // Apply linear blending constraint - limit control point deviation
            const controlX = midX + influenceFactor * (c1.x - midX);
            const controlY = midY + influenceFactor * (c1.y - midY);
            
            // Use the constrained control point
            ctx.quadraticCurveTo(controlX, controlY, endX, endY);
          }
          
          // Add the final segment if we have enough points
          if (centroids.length >= 3) {
            const last = centroids.length - 1;
            const secondLast = centroids.length - 2;
            
            // Apply same constraint to final segment
            const prevEndX = (centroids[secondLast-1].x + centroids[secondLast].x) / 2;
            const prevEndY = (centroids[secondLast-1].y + centroids[secondLast].y) / 2;
            const lastX = centroids[last].x;
            const lastY = centroids[last].y;
            
            // Reference midpoint
            const midX = (prevEndX + lastX) / 2;
            const midY = (prevEndY + lastY) / 2;
            
            // Constrained control point
            const controlX = midX + influenceFactor * (centroids[secondLast].x - midX);
            const controlY = midY + influenceFactor * (centroids[secondLast].y - midY);
            
            ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
          }
          
          ctx.stroke();
        }
      }
    }
  }
  
  public updateParams(params: AnimationParams) {
    const updateOvalNeeded = 
      this.params.showOval !== params.showOval ||
      this.params.ovalPosition !== params.ovalPosition ||
      this.params.ovalEccentricity !== params.ovalEccentricity ||
      this.params.mouthOpening !== params.mouthOpening;
    
    this.params = params;
    
    if (updateOvalNeeded) {
      this.updateOval();
    }
  }
  
  /**
   * Creates a new oval composite
   * Separated from updateOval for better code organization
   */
  private createOvalBody(
    ovalCenterX: number, 
    ovalCenterY: number, 
    ovalWidth: number, 
    ovalHeight: number, 
    mouthOpening: number
  ): Matter.Composite {
    // Create a composite to hold all segment bodies
    const ovalComposite = Matter.Composite.create();
    
    // More segments for smoother oval
    const segments = 49;
    
    // Calculate the oval circumference step angle
    const angleStep = (Math.PI * 2) / segments;
    
    for (let i = 0; i < segments; i++) {
      // Calculate start and end angle of this segment
      const startAngle = i * angleStep;
      const endAngle = startAngle + angleStep;
      
      // Calculate whether this segment should be part of the "mouth" opening
      // The mouth should be symmetrical about the horizontal axis
      
      // Calculate the mouth opening angle based on mouthOpening parameter
      // When mouthOpening is 0, there's no opening
      // When mouthOpening is 1, half of the oval is open (PI radians)
      const mouthWidth = mouthOpening * Math.PI; // up to 180 degrees
      
      // Normalize angle to [0, 2π)
      const midAngle = ((startAngle + endAngle) / 2 + Math.PI * 2) % (Math.PI * 2);
      
      // Determine if this segment is in the mouth region
      let inMouthRegion = false;
      
      if (this.isRTL) {
        // For RTL, the opening is on the left side (π radians)
        // For angles in the left half of the circle, we need the smaller angle to the horizontal
        const angleFromLeftHorizontal = Math.abs(midAngle - Math.PI);
        
        // The mouth should be centered on the left side (π radians) 
        // and symmetrical up and down (from 3π/2 to π/2, going clockwise)
        inMouthRegion = (angleFromLeftHorizontal <= mouthWidth/2) && 
                        // This ensures we're on the left side of the oval
                        (midAngle > Math.PI/2 && midAngle < Math.PI * 3/2);
      } else {
        // For LTR, the opening is on the right side (0 or 2π radians)
        // We need the smaller angle to the horizontal axis
        const angleFromRightHorizontal = (midAngle <= Math.PI) 
                                       ? midAngle 
                                       : 2 * Math.PI - midAngle;
        
        // The mouth should be centered on the right side (0 radians)
        // and symmetrical up and down (from π/2 to 3π/2, going counterclockwise) 
        inMouthRegion = (angleFromRightHorizontal <= mouthWidth/2) && 
                        // This ensures we're on the right side of the oval
                        (midAngle < Math.PI/2 || midAngle > Math.PI * 3/2);
      }
      
      // Skip creating this segment if it's part of the mouth opening
      if (inMouthRegion) {
        continue;
      }
      
      // Calculate vertices of the segment
      const startX = ovalCenterX + Math.cos(startAngle) * ovalWidth;
      const startY = ovalCenterY + Math.sin(startAngle) * ovalHeight;
      const endX = ovalCenterX + Math.cos(endAngle) * ovalWidth;
      const endY = ovalCenterY + Math.sin(endAngle) * ovalHeight;
      
      // Create thickness for the oval wall - offset inward
      const innerScale = 0.9; // 10% smaller for thickness
      const innerStartX = ovalCenterX + Math.cos(startAngle) * ovalWidth * innerScale;
      const innerStartY = ovalCenterY + Math.sin(startAngle) * ovalHeight * innerScale;
      const innerEndX = ovalCenterX + Math.cos(endAngle) * ovalWidth * innerScale;
      const innerEndY = ovalCenterY + Math.sin(endAngle) * ovalHeight * innerScale;
      
      // Create a quad segment using 4 vertices
      const segment = Matter.Bodies.fromVertices(
        (startX + endX + innerStartX + innerEndX) / 4, // center x
        (startY + endY + innerStartY + innerEndY) / 4, // center y
        [[
          { x: startX, y: startY },
          { x: endX, y: endY },
          { x: innerEndX, y: innerEndY },
          { x: innerStartX, y: innerStartY }
        ]],
        {
          isStatic: true, // Oval doesn't move
          friction: 0.0,
          frictionStatic: 0.0,
          frictionAir: 0,
          restitution: 1.0, // perfectly elastic
          slop: 0.005, // reduced from default for precise collisions
          collisionFilter: {
            category: 0x0002, // Oval category
            mask: 0x0001, // Only collide with particles
            group: 0
          }
        }
      );
      
      // Add the segment to the composite
      Matter.Composite.add(ovalComposite, segment);
    }
    
    // Return the complete oval composite
    return ovalComposite;
  }
  
  private updateOval() {
    // If the oval already exists, remove it from the world
    if (this.ovalBody) {
      Matter.Composite.remove(this.engine.world, this.ovalBody);
      this.ovalBody = null;
    }
    
    if (!this.params.showOval) {
      this.engine.timing.timeScale = 1.0; // Reset time scale with no oval
      return;
    }
    
    // Get canvas dimensions
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Calculate oval positioning based on the ovalPosition parameter (0.0 to 1.0)
    // This places the oval horizontally across the canvas with 20% padding on each side
    const ovalCenterX = width * (0.2 + this.params.ovalPosition * 0.6);
    const ovalCenterY = height / 2; // Vertical center
    
    // Calculate oval dimensions - using a size based on canvas height
    const ovalBaseSize = height * 0.35; // 35% of canvas height
    
    // Apply eccentricity - lower values make a more circular oval
    // 0.0 = perfect circle, 1.0 = very elongated horizontal oval
    const eccentricity = this.params.ovalEccentricity;
    const ovalWidth = ovalBaseSize * (1 + eccentricity );
    const ovalHeight = ovalBaseSize * (1 - eccentricity);
    
    // Create the oval composite with the mouth opening parameter
    this.ovalBody = this.createOvalBody(
      ovalCenterX, 
      ovalCenterY, 
      ovalWidth, 
      ovalHeight, 
      this.params.mouthOpening
    );
    
    // Add the oval to the physics world
    Matter.Composite.add(this.engine.world, this.ovalBody);
    
    // When the oval is present, use more substeps for more accurate collision detection
    this.engine.timing.timeScale = 0.5; // Slow down physics by half
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
  }
  
  public cleanup() {
    this.pause();
    Matter.Engine.clear(this.engine);
    this.bubbles = [];
    this.segmentGlows = [];
  }
  
  private drawFrame(progress: number) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
  
    // Apply stronger motion blur effect instead of completely clearing the canvas
    // Set a semi-transparent black rectangle over the previous frame
    // Lower alpha = more motion blur (longer trails)
    ctx.fillStyle = "rgba(26, 26, 26, 0.65)"; // Dark background with alpha for more pronounced motion blur
    ctx.fillRect(0, 0, width, height);
    
    // Update glow data for oval segments (data management only)
    this.renderOvalGlow(ctx, performance.now());
  
    // Check if we need to generate bubbles
    // Use progress to ensure bubbles are generated exactly once per cycle
    const cyclePct = progress * 100;
    // Generate bubbles when we're at the activation line (around 30% into the cycle)
    const activationPoint = CanvasController.ACTIVATION_LINE_POSITION * 100;
    const prevCyclePct = ((performance.now() - 16.67) - (this.startTime || 0)) % CanvasController.CYCLE_PERIOD_MS / CanvasController.CYCLE_PERIOD_MS * 100;
    
    // Generate bubbles when crossing the activation point (previous frame was before, current frame is after)
    if (prevCyclePct < activationPoint && cyclePct >= activationPoint) {
      console.log('Generating bubbles at cycle', this.currentCycleNumber + 1);
      // Generate new bubbles at the activation line
      const newBubbles = this.generateBubbles(this.activationLineX);
      // Add to the list of bubbles
      this.bubbles.push(...newBubbles);
      // Emit cycle started event if callback is registered
      if (this.onCycleStart) this.onCycleStart();
      
      // Update cycle time and cycle number
      this.lastCycleTime = performance.now();
      this.currentCycleNumber++;
    }
    
    // Collect all particles by collision state
    let allParticles: Particle[] = [];
    let collidedParticles: Particle[] = [];
    let nonCollidedParticles: Particle[] = [];
    
    // Update all bubbles and remove fully decayed ones
    this.bubbles = this.bubbles.filter(bubble => {
      // Update energy based on particles
      this.updateBubbleEnergy(bubble);
      
      // Filter empty bubbles
      if (bubble.particles.length === 0) return false;
      
      // Check if too old (by cycle number)
      if (this.currentCycleNumber - bubble.cycleNumber > CanvasController.PARTICLE_LIFETIME_CYCLES) {
        // Remove all physics bodies from the world
        for (const particle of bubble.particles) {
          Matter.Composite.remove(this.engine.world, particle.body);
        }
        return false;
      }
      
      // Collect particles for rendering
      for (const particle of bubble.particles) {
        allParticles.push(particle);
        
        if (particle.collided > 0) {
          collidedParticles.push(particle);
        } else {
          nonCollidedParticles.push(particle);
        }
      }
      
      return true;
    });
    
    // Draw UI elements (sweep lines, etc.)
    this.drawUIElements(width, height, progress);
    
    // Draw oval glow (if needed)
    if (this.params.showOval && this.ovalBody) {
      // Draw each oval segment with a very faint gray fill
      const segments = Matter.Composite.allBodies(this.ovalBody);
      
      // Simple approach: draw each segment with a fill
      for (const segment of segments) {
        // Find if this segment has a glow from collision
        const segmentGlow = this.segmentGlows.find(glow => glow.segmentId === segment.id);
        
        // Get the vertices of the segment
        const verts = segment.vertices;
        
        // Draw the segment with a fill
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        ctx.lineTo(verts[1].x, verts[1].y);
        ctx.lineTo(verts[2].x, verts[2].y);
        ctx.lineTo(verts[3].x, verts[3].y);
        ctx.closePath();
        
        // More noticeable gray fill by default
        let fillOpacity = 0.2; // Slightly more visible default
        let glowColor = "255, 255, 255"; // White glow by default
        
        // If this segment has been hit, increase opacity based on impact intensity
        if (segmentGlow && segmentGlow.intensity > 0) {
          // Decay the glow intensity over time
          const timeElapsed = performance.now() - segmentGlow.lastUpdateTime;
          const decayFactor = Math.max(0, 1 - timeElapsed / 800); // Faster decay for more dynamic effect
          
          // Apply decay to the intensity
          const adjustedIntensity = segmentGlow.intensity * decayFactor;
          
          // Map intensity to opacity (0.2 to 0.8)
          fillOpacity = 0.4 + Math.min(0.4, adjustedIntensity * 0.3);
          
          // Use a bright cyan color for impacted segments
          glowColor = "100, 255, 255";
        }
        
        // Fill with appropriate color and opacity
        ctx.fillStyle = `rgba(${glowColor}, ${fillOpacity})`;
        ctx.fill();
      }
    }
    
    // Draw wave visualization if enabled
    if (this.params.showWaves) {
      if (this.params.showSmooth) {
        // Draw smoothed curves through particle groups, grouped by cycle
        this.renderSmoothWavesByCycle(ctx, nonCollidedParticles, collidedParticles);
      } else {
        // Draw simpler piecewise linear wave visualization
        this.renderWaves(ctx);
      }
    }
    
    // Draw individual particles if enabled
    if (this.showParticles) {
      for (const particle of allParticles) {
        this.renderParticle(
          ctx, 
          particle.body.position, 
          0.5, // Base opacity
          particle, // Passing particle for energy/color data
CanvasController.PARTICLE_RADIUS// Base size
        );
      }
    }

    // Track render stats
    this.frameCounter++;
  }
  
  private animate() {
    const currentTime = performance.now();
    if (!this.startTime) this.startTime = currentTime;
    
    const progress = ((currentTime - this.startTime) % CanvasController.CYCLE_PERIOD_MS) / CanvasController.CYCLE_PERIOD_MS;
    
    // Draw the current frame
    this.drawFrame(progress);
    
    // Update physics engine at a fixed timestep
    this.updatePhysics(currentTime);
    
    // Request the next animation frame
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }
  
  private updatePhysics(timestamp: number) {
    // Update using multiple smaller steps for more accurate collision detection
    // Use more substeps when the oval is present (8 vs 4)
    const numSteps = this.params.showOval ? 6 : 3;
    
    // Calculate the timestep size (in seconds)
    const timeStep = CanvasController.PHYSICS_TIMESTEP_MS / 1000 / numSteps;
    
    // Apply multiple smaller steps
    for (let i = 0; i < numSteps; i++) {
      Matter.Engine.update(this.engine, timeStep * 1000, 1.0); // Use second param in ms
    }
  }
}