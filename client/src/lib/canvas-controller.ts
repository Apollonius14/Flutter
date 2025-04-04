import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; 
  ovalEccentricity: number;
  semiLatusRectum?: number; // p parameter for conic section
}

interface Particle {
  body: Matter.Body;
  groupId: number;
  cycleNumber: number;
  index: number; 
  energy: number; 
  initialEnergy: number;
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
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.51;  
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 3;
  private static readonly PHYSICS_TIMESTEP_MS: number = 10; 
  private static readonly ACTIVATION_LINE_POSITION: number = 0.25; 
  private static readonly BASE_LINE_WIDTH: number = 1.0;
  private static readonly PARTICLES_PER_RING: number = 71;
  private static readonly PARTICLE_RADIUS: number = 1;
  private static readonly FIXED_BUBBLE_RADIUS: number = 2; 

  private static readonly JOIN_CURVE_ENDS: boolean = false;
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
      particleAngles.push(angle * (1 - 0.85 * Math.sin(angle) * Math.sin(angle)));
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
      positionIterations: 6,
      velocityIterations: 6,
      constraintIterations: 4
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5,
      ovalEccentricity: 0.3,
      semiLatusRectum: 0.5 // Default p parameter for conic section
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
          let segment, particle;
          
          if (pair.bodyA.collisionFilter.category === 0x0002) {
            segment = pair.bodyA;
            particle = pair.bodyB;
          } else if (pair.bodyB.collisionFilter.category === 0x0002) {
            segment = pair.bodyB;
            particle = pair.bodyA;
          } else {
            continue; 
          }

          const segmentId = segment.id;
          

          const collision = pair.collision;
          const normal = collision ? { x: collision.normal.x, y: collision.normal.y } : { x: 0, y: 0 };
          
          // Get particle velocity
          const velocity = {
            x: this.params.power * particle.velocity.x,
            y: particle.velocity.y
          };
          
          // Calculate dot product of velocity and normal for collision
          const dotProduct = velocity.x * normal.x + velocity.y * normal.y;
          
          // Take absolute value since we care about magnitude of impact, not direction
          const impactMagnitude = Math.abs(dotProduct);
          
          // Apply a threshold to filter out tiny collisions and static noise
          // Ignore collisions that don't meet the minimum threshold
          const COLLISION_THRESHOLD = 0.35;
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
    const compressionFactor = 0.15; // Reduced to create a more zoomed-out view
    const center = canvasHeight / 2;
    const numPositions = 9; 
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 6);
    const halfSpacing = baseSpacing / 10;

    // Add positions from top to bottom, offset from center
    positions.push(center - halfSpacing - baseSpacing * 4);
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center);
    positions.push(center + halfSpacing + baseSpacing);
    positions.push(center + halfSpacing + baseSpacing * 2);
    positions.push(center + halfSpacing + baseSpacing * 3);
    positions.push(center + halfSpacing + baseSpacing * 4);

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
      const radiusMultiplier = 0.5 + 1 * Math.cos(normalizedPos * Math.PI);
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

        const baseSpeed = 8.0; 


        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * baseSpeed,
          y: Math.sin(angle) * baseSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        // Initialize particle with energy based on the power parameter
        const particle: Particle = {
          body,
          groupId: groupId,
          cycleNumber: this.currentCycleNumber,
          index: idx,
          energy: this.params.power,
          initialEnergy: this.params.power
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
    let finalOpacity = opacity;
    if (particle) {
      // Use particle's energy level directly
      const energyRatio = particle.energy / particle.initialEnergy;
      finalOpacity = energyRatio * 0.8; // Slightly brighter than the base opacity
    } else {
      // Use passed opacity as fallback
      finalOpacity = opacity * 0.8;
    }
    
    // Draw a filled circle for the particle
    ctx.beginPath();
    ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(254, 37, 3, ${finalOpacity})`;
    ctx.fill();
  }
  
  /**
   * Renders glowing oval segments based on collision data
   * Enhanced for better handling of varying segment counts and open curves
   */
  private renderOvalGlow(ctx: CanvasRenderingContext2D, timestamp: number): void {
    if (!this.ovalBody || !this.params.showOval) return;
    
    // Get all segments of the oval
    const segments = Matter.Composite.allBodies(this.ovalBody);
    
    // If we have no segments (completely invalid curve), exit early
    if (segments.length === 0) return;
    
    // Filter out old glows based on decay rate
    const now = timestamp;
    
    // Process each segment glow - remove glows older than 6 seconds
    this.segmentGlows = this.segmentGlows.filter(glow => {
      const age = (now - glow.lastUpdateTime) / 1000;
      return age < 6; // Keep longer lasting effects
    });
    
    // Determine if we need to adjust glow intensity based on segment count
    // More segments = smaller individual glows, so we need to compensate
    // Square root scaling gives a good balance for segment count differences
    const segmentCountFactor = Math.max(1, Math.sqrt(75 / segments.length));
    
    // Adjust base glow intensity based on eccentricity
    // Parabolas and hyperbolas need more pronounced glows to be visible
    const eccentricityBoost = this.params.ovalEccentricity > 0.9 ? 
      1.5 + (this.params.ovalEccentricity - 0.9) * 5 : 1.0;
    
    const baseAlpha = 0.05 * eccentricityBoost;
    
    // First draw all segments with a very faint base fill
    segments.forEach(segment => {
      const vertices = segment.vertices;
      
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      
      // Enhanced base glow with eccentricity boost
      ctx.fillStyle = `rgba(255, 200, 230, ${baseAlpha})`; 
      ctx.fill();
    });
    
    // Then draw only the segments with active glows with more vibrant colors
    segments.forEach(segment => {
      // Get segment position for unique ID generation
      const pos = segment.position;
      // Create a unique ID based on position (more robust than using index)
      const segmentId = Math.floor(pos.x * 100) + Math.floor(pos.y * 100) * 1000;
      
      // Find the glow for this segment
      let glow = this.segmentGlows.find(g => g.segmentId === segmentId);
      
      // Initialize new glows with a small ambient value
      if (!glow) {
        glow = {
          segmentId: segmentId,
          intensity: 0.02 * eccentricityBoost, // Higher ambient glow for extreme shapes
          lastUpdateTime: now
        };
        this.segmentGlows.push(glow);
      }
      
      // Calculate how old this glow is in seconds
      const glowAge = (now - glow.lastUpdateTime) / 1000;
      
      // Apply smoother exponential decay with longer persistence for extreme shapes
      const decayRate = 7 / eccentricityBoost; // Slower decay for extreme shapes
      const currentIntensity = glow.intensity * Math.exp(-decayRate * glowAge);
      
      // Skip rendering if intensity is too low
      if (currentIntensity < 0.01) return;
      
      // Render segment with enhanced glow
      const vertices = segment.vertices;
      
      // Calculate adjusted intensity based on segment count
      const adjustedIntensity = currentIntensity * segmentCountFactor;
      
      // Get segment dimensions for glow sizing
      const bounds = (segment as any).bounds;
      const segmentLength = bounds.max.x - bounds.min.x;
      const segmentWidth = bounds.max.y - bounds.min.y;
      const segmentSize = Math.max(segmentLength, segmentWidth);
      
      // Apply a radial gradient glow effect
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(segment.angle);
      
      // Calculate glow size based on multiple factors
      const baseGlowSize = Math.max(segmentWidth * 3, 30);
      const intensityScaledSize = baseGlowSize * (1 + adjustedIntensity);
      const finalGlowSize = intensityScaledSize * eccentricityBoost;
      
      // Create radial gradient for glow effect
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, finalGlowSize / 2);
      
      // Calculate colors based on intensity
      const r = 255;
      const g = Math.max(20, Math.min(180, 90 + adjustedIntensity * 90));
      const b = Math.max(150, Math.min(240, 170 + adjustedIntensity * 70));
      
      // Inner color (bright)
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${Math.min(0.7, adjustedIntensity * 0.4)})`);
      // Mid color
      gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${adjustedIntensity * 0.2})`);
      // Outer color (transparent)
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      
      // Apply gradient fill
      ctx.fillStyle = gradient;
      ctx.fillRect(
        -segmentLength/2 - finalGlowSize/2, 
        -segmentWidth/2 - finalGlowSize/2, 
        segmentLength + finalGlowSize, 
        segmentWidth + finalGlowSize
      );
      
      ctx.restore();
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
  
  // Removed setShowPaths method

  public updateParams(params: AnimationParams) {
    const prevShowOval = this.params.showOval;
    const prevPosition = this.params.ovalPosition;
    const prevEccentricity = this.params.ovalEccentricity;
    const prevSemiLatusRectum = this.params.semiLatusRectum;

    this.params = params;

    // Check if oval-related parameters have changed
    const ovalChanged = prevShowOval !== params.showOval || 
                        prevPosition !== params.ovalPosition || 
                        prevEccentricity !== params.ovalEccentricity ||
                        prevSemiLatusRectum !== params.semiLatusRectum;

    if (ovalChanged) {
      // If position changed, but eccentricity and semiLatusRectum stayed the same, we can optimize
      const eccentricityChanged = prevEccentricity !== params.ovalEccentricity;
      const semiLatusRectumChanged = prevSemiLatusRectum !== params.semiLatusRectum;
      
      // If we need to create a new oval, delete the old one first
      if (this.ovalBody && (eccentricityChanged || semiLatusRectumChanged || prevShowOval !== params.showOval)) {
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
   * Calculates a point on a conic section in polar form
   * @param eccentricity - Controls the type of curve (0: circle, 0-1: ellipse, 1: parabola, >1: hyperbola)
   * @param semiLatusRectum - Size parameter (often denoted as 'p')
   * @param theta - Angle in radians
   * @returns The point coordinates at the given angle or null if the angle is in an invalid range
   */
  private conicSectionPoint(
    centerX: number,
    centerY: number, 
    eccentricity: number,
    semiLatusRectum: number,
    theta: number,
    scale: number
  ): Point2D | null {
    // Apply nonlinear scaling to make the parameters less sensitive
    // Apply cubic scaling to eccentricity when approaching 1 (makes transition smoother)
    let effectiveEccentricity = eccentricity;
    if (eccentricity > 0.8 && eccentricity < 1) {
      // Slow down the approach to 1 (parabola) with cubic scaling
      const normalizedE = (eccentricity - 0.8) / 0.2; // 0 to 1 scale
      effectiveEccentricity = 0.8 + 0.2 * Math.pow(normalizedE, 3);
    }
    
    // Scale the semiLatusRectum param to be less sensitive too
    let effectiveP = semiLatusRectum;
    // Apply quadratic scaling to make small changes have less dramatic effects
    effectiveP = Math.pow(semiLatusRectum, 2);
    
    // For parabolas (e=1) and hyperbolas (e>1), we need to limit the angle range
    // to create open curves instead of closed ones
    if (effectiveEccentricity >= 0.98) { // Near parabola or hyperbola 
      // For parabola and hyperbola, only show a limited arc (not a full 360)
      // As we get closer to or exceed e=1, we narrow the valid angle range
      const arcSizeRadians = Math.PI * (1.0 - Math.min(0.8, Math.abs(effectiveEccentricity - 0.95))); 
      
      // Map angular range to being centered around 0 for easier calculations
      const normalizedTheta = ((theta + Math.PI) % (2 * Math.PI)) - Math.PI; // -PI to PI
      
      // Check if we're outside the valid arc - return null to indicate no valid point
      if (Math.abs(normalizedTheta) > arcSizeRadians / 2) {
        return null; // No point to draw in this region - creates open curves
      }
    }
    
    // For hyperbola specifically
    if (effectiveEccentricity > 1) {
      // For hyperbola, limit angles to valid range to avoid division by zero
      const limitAngle = Math.acos(1 / effectiveEccentricity);
      // If within the "forbidden zone", return null
      if (Math.abs(theta) < limitAngle) {
        return null; // Creates the gap in hyperbola
      }
    }
    
    // Calculate radius using polar form of conic section
    const denominator = 1 - effectiveEccentricity * Math.cos(theta);
    
    // Safety check - avoid division by zero or extremely small denominators
    if (Math.abs(denominator) < 0.001) {
      return null; // Skip this point rather than creating extreme values
    }
    
    // Calculate the radius with all our scaled parameters
    const radius = (effectiveP / denominator) * scale;
    
    // Set a reasonable limit on radius to prevent extremely large points
    const MAX_RADIUS = 2000;
    if (Math.abs(radius) > MAX_RADIUS) {
      return null; // Skip extremely large points
    }
    
    // Convert to Cartesian coordinates centered at (centerX, centerY)
    return {
      x: centerX + radius * Math.cos(theta),
      y: centerY + radius * Math.sin(theta)
    };
  }

  /**
   * Creates a new oval composite based on a conic section
   * Separated from updateOval for better code organization
   */
  private createOvalBody(
    centerX: number,
    centerY: number,
    majorAxis: number,
    minorAxis: number
  ): Matter.Composite {
    const wallThickness = 16;
    const ovalBody = Matter.Composite.create();
    
    // Get p parameter from params, or use a default
    const semiLatusRectum = this.params.semiLatusRectum || 0.5;
    // Scale factor to adjust overall size
    const scale = majorAxis / 4;
    
    // Increase segments for smoother curves, especially important for extreme conic sections
    const segments = this.params.ovalEccentricity > 0.9 ? 150 : 75;
    
    // Store points to create continuous segments
    const validPoints: Point2D[] = [];
    
    // First, collect all valid points around the curve
    for (let i = 0; i <= segments; i++) {
      // Calculate angle for this point
      const angle = (i / segments) * Math.PI * 2;
      
      // Get point if it exists in the valid domain
      const point = this.conicSectionPoint(
        centerX, 
        centerY, 
        this.params.ovalEccentricity,
        semiLatusRectum,
        angle,
        scale
      );
      
      // If we got a valid point, add it to our collection
      if (point !== null) {
        validPoints.push(point);
      }
    }
    
    // Now create segments between consecutive valid points
    for (let i = 0; i < validPoints.length - 1; i++) {
      // Since we filtered for non-null points above, these are guaranteed to exist
      const p1 = validPoints[i];
      const p2 = validPoints[i + 1];
      
      // Skip if points are too far apart (discontinuity in the curve)
      const distance = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + 
        Math.pow(p2.y - p1.y, 2)
      );
      
      // Skip creating segments that bridge across a gap in the curve
      // This prevents connecting the two sides of a hyperbola or parabola
      const MAX_SEGMENT_LENGTH = 100; // Adjust based on testing
      if (distance > MAX_SEGMENT_LENGTH) {
        continue;
      }
      
      // Calculate midpoint and segment properties
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const segmentLength = distance;
      const segmentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      
      // Create physics body for this segment
      const segment = Matter.Bodies.rectangle(midX, midY, segmentLength, wallThickness, {
        isStatic: true,
        angle: segmentAngle,
        restitution: 1.0,
        friction: 0,
        frictionAir: 0,
        frictionStatic: 0,
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
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.15)'; 
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
    const numSubSteps = this.params.showOval ? 6 : 3; // Doubled substeps: 8 when oval present, 4 when not
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