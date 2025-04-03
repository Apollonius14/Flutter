import * as Matter from 'matter-js';


// Path Loop Closed or Open
const JOIN_CURVE_ENDS: boolean = false;

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; 
  ovalEccentricity: number; // 
  curveType: "cubic" | "quadratic" | "linear" | "glow"; // Type of curve to use for rendering
}

interface Particle {
  body: Matter.Body;
  groupId: number;
  cycleNumber: number;
  index: number; // Fixed index in the bubble's particles array
  energy: number; // Current energy level
  initialEnergy: number; // Starting energy level
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

// New interface for particle wavefronts
interface WaveFront {
  points: Point2D[];
  energy: number;
  waveIndex: number;
  thicknessFactor: number;
  baseOpacity: number;  
  cycleNumber: number; 
}

// Interface for segment glow data
interface SegmentGlow {
  intensity: number;
  lastUpdateTime: number;
  segmentId: number;
}

// Interface for rendering parameters
interface RenderParams {
  showShadow: boolean;     
  power: number;  
  screenBounds: {
    min: Point2D;
    max: Point2D;
  };
}

export class CanvasController {
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.6;  
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 2;
  private static readonly PHYSICS_TIMESTEP_MS: number = 12; 
  private static readonly ACTIVATION_LINE_POSITION: number = 0.25; 
  private static readonly BASE_LINE_WIDTH: number = 1.0;
  private static readonly PARTICLES_PER_RING: number = 71;
  private static readonly PARTICLE_RADIUS: number = 0.9;
  private static readonly FIXED_BUBBLE_RADIUS: number = 5; 

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
      particleAngles.push(angle * (1 - 0.8 * Math.sin(angle) * Math.sin(angle)));
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
      positionIterations: 4,    // Increased for better physics accuracy
      velocityIterations: 4,    // Increased for smoother motion
      constraintIterations: 3
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5,
      ovalEccentricity: 0.7,
      curveType: "cubic"
    };

    this.activationLineX = canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';

    // Initialize the oval if needed
    this.updateOval();
    
    // Set up collision detection for the glow effect
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // Only process collisions when glow visualization is active
      if (this.params.curveType === "glow" && this.params.showOval && this.ovalBody) {
        const pairs = event.pairs;
        const now = performance.now(); // Use performance.now() for consistent timing
        
        // Process each collision pair
        for (const pair of pairs) {
          // We need to identify which body is the oval segment
          // Particles have category 0x0001, oval segments have 0x0002
          let segment, particle;
          
          if (pair.bodyA.collisionFilter.category === 0x0002) {
            segment = pair.bodyA;
            particle = pair.bodyB;
          } else if (pair.bodyB.collisionFilter.category === 0x0002) {
            segment = pair.bodyB;
            particle = pair.bodyA;
          } else {
            continue; // Skip if neither is an oval segment
          }
          
          // Get segment index - we use body.id to identify the segment
          const segmentId = segment.id;
          
          // Get collision normal (unit vector perpendicular to the surface at collision point)
          const collision = pair.collision;
          const normal = collision ? { x: collision.normal.x, y: collision.normal.y } : { x: 0, y: 0 };
          
          // Get particle velocity
          const velocity = {
            x: this.params.power * particle.velocity.x,
            y: particle.velocity.y
          };
          
          // Calculate dot product of velocity and normal (scalar projection of velocity onto normal)
          // This gives us the component of velocity perpendicular to the collision surface
          const dotProduct = velocity.x * normal.x + velocity.y * normal.y;
          
          // Take absolute value since we care about magnitude of impact, not direction
          const impactMagnitude = Math.abs(dotProduct);
          
          // Square the dot product to emphasize stronger collisions (quadratic scaling)
          const squaredImpact = impactMagnitude * impactMagnitude;
          
          // Get particle's energy if it's available (particles are stored in this.bubbles[i].particles)
          let particleEnergy = 1.0; // Default if we can't find the particle
          
          // Find the corresponding Particle object by searching through all bubbles
          for (const bubble of this.bubbles) {
            for (const p of bubble.particles) {
              if (p.body.id === particle.id) {
                particleEnergy = p.energy / p.initialEnergy; // Use energy ratio
                break;
              }
            }
          }
          
          // Scale impact by energy and power (with squared impact for more emphasis on direct hits)
          const scaledImpact = squaredImpact * particleEnergy * this.params.power * 1.5; // Multiply by 1.5 to increase intensity
          
          // Normalize to a reasonable range (0 to 1.5) - allowing higher maximum for more dramatic effects
          const normalizedIntensity = Math.min(scaledImpact, 1.5);
          
          // Check if there's already a glow for this segment
          const existingGlowIndex = this.segmentGlows.findIndex(glow => glow.segmentId === segmentId);
          
          if (existingGlowIndex >= 0) {
            // Update existing glow intensity (add new intensity, capped at 1.0)
            const existingGlow = this.segmentGlows[existingGlowIndex];
            existingGlow.intensity = Math.min(existingGlow.intensity + normalizedIntensity, 10.0);
            existingGlow.lastUpdateTime = now;
          } else {
            // Create new glow record
            this.segmentGlows.push({
              segmentId,
              intensity: normalizedIntensity,
              lastUpdateTime: now
            });
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
    const compressionFactor = 0.2; // Higher value to use more vertical space
    const center = canvasHeight / 2;
    const numPositions = 9; 
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 3);
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

        const baseSpeed = 4.0; 


        // Set velocity - still using the original angle, but with adjusted speed
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
      const decay = particle.initialEnergy * 0.0015 * velocityFactor;
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

  /**
   * Calculates and organizes particle wave fronts based on velocity direction
   * Groups particles by cycle number and dot product of velocity with X-axis
   */
  private calculateWaveFronts(bubbles: Bubble[], screenBounds: {min: Point2D, max: Point2D}): WaveFront[] {
    const waveFronts: WaveFront[] = [];

    // Step 1: Group all particles by cycle number
    const particlesByCycle: Map<number, Particle[]> = new Map();

    for (const bubble of bubbles) {
      // Skip bubbles with no energy
      if (bubble.energy <= 0 || bubble.particles.length === 0) {
        continue;
      }

      // Add particles to their cycle group
      const cycleNumber = bubble.cycleNumber;
      if (!particlesByCycle.has(cycleNumber)) {
        particlesByCycle.set(cycleNumber, []);
      }
      particlesByCycle.get(cycleNumber)!.push(...bubble.particles);
    }

    // Process each cycle group
    // Convert Map entries to array for TypeScript compatibility
    Array.from(particlesByCycle.entries()).forEach(([cycleNumber, cycleParticles]) => {
      // Step 2: Filter visible particles
      const visibleParticles = cycleParticles.filter((p: Particle) => {
        const pos = p.body.position;
        return pos.x >= screenBounds.min.x && 
               pos.x <= screenBounds.max.x && 
               pos.y >= screenBounds.min.y && 
               pos.y <= screenBounds.max.y;
      });

      if (visibleParticles.length < 3) {
        return; // Skip if not enough particles for a meaningful wavefront
      }

      // Step 3: Calculate dot product of velocity with positive X-axis
      // and filter out particles moving close to vertical
      interface ParticleWithDirection {
        particle: Particle;
        dotProduct: number;
      }

      const directionBasedParticles = visibleParticles.map((p: Particle): ParticleWithDirection => {
        const velocity = p.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

        // Calculate normalized dot product (cosine of angle with x-axis)
        // If speed is 0, use 0 as the dot product
        const dotProduct = speed === 0 ? 0 : velocity.x / speed;

        return {
          particle: p,
          dotProduct
        };
      }).filter((item: ParticleWithDirection) => {
        // Filter out particles moving nearly vertically (dot product close to 0)
        return Math.abs(item.dotProduct) >= 0.2;
      });

      // Step 4: Group particles into buckets based on dot product
      interface DotProductRange {
        min: number;
        max: number;
      }

      const dotProductRanges: DotProductRange[] = [
        { min: 0.1, max: 0.4 },
        { min: 0.4, max: 0.7 },
        { min: 0.7, max: 0.85 },
        { min: 0.85, max: 1.0 },
        { min: -0.4, max: -0.1 },
        { min: -0.7, max: -0.4 },
        { min: -0.85, max: -0.7 },
        { min: -1.0, max: -0.85}
      ];

      // Group particles by their dot product range
      const particlesByDirection: Map<number, Particle[]> = new Map();

      for (let i = 0; i < dotProductRanges.length; i++) {
        const range = dotProductRanges[i];
        const particlesInRange = directionBasedParticles.filter((item: ParticleWithDirection) => 
          item.dotProduct >= range.min && item.dotProduct <= range.max
        ).map((item: ParticleWithDirection) => item.particle);

        // Only add groups with enough particles
        if (particlesInRange.length >= 2) {
          particlesByDirection.set(i, particlesInRange);
        }
      }

      // Step 5: Create wavefronts from each direction group
      for (let directionIndex = 0; directionIndex < dotProductRanges.length; directionIndex++) {
        // Skip if no particles in this direction bucket
        if (!particlesByDirection.has(directionIndex)) continue;

        const groupParticles = particlesByDirection.get(directionIndex)!;
        // Sort particles by y-coordinate (greatest to smallest) as requested
        const orderedParticles = [...groupParticles].sort((a, b) => b.body.position.y - a.body.position.y);

        // Extract just the particle positions for the wave front
        const points: Point2D[] = orderedParticles.map(p => ({
          x: p.body.position.x,
          y: p.body.position.y
        }));

        // Calculate average energy from the particle's energy values
        // This uses the energy property we set on each particle
        const avgEnergy = orderedParticles.reduce((sum, p) => sum + p.energy, 0) / orderedParticles.length;


        const thicknessFactor = 2;
        const baseOpacity = 0.9; 
        waveFronts.push({
          points,
          energy: avgEnergy,  // Direct use of particle energy values without artificial multiplier
          waveIndex: directionIndex, 
          thicknessFactor,
          baseOpacity,
          cycleNumber
        });
      }
    });

    return waveFronts;
  }

  /** Generates a path through a set of points using cubic or quadratic Bézier curves, linear segments **/

  private closePathIfNeeded(path: Path2D, points: Point2D[]): void {
    if (JOIN_CURVE_ENDS) {
      if (points.length > 2) {
        const pFirst = points[0];
        const pLast = points[points.length - 1];

        // If first and last points aren't already the same, connect them
        if (pFirst.x !== pLast.x || pFirst.y !== pLast.y) {
          path.lineTo(pFirst.x, pFirst.y);
        }
      }
      path.closePath();
    }
  }

  /**
   * Apply a simple smoothing algorithm to a set of points
   * Uses the Chaikin's corner cutting algorithm for curve smoothing
   * @param points Original points
   * @param iterations Number of smoothing iterations
   * @returns Smoothed points array
   */
  private smoothPoints(points: Point2D[], iterations: number = 1): Point2D[] {
    if (points.length <= 2 || iterations <= 0) {
      return points;
    }
    
    // Create a copy to avoid modifying the original
    let result = [...points];
    
    for (let iter = 0; iter < iterations; iter++) {
      const smoothed: Point2D[] = [];
      
      // Always keep the first point
      smoothed.push(result[0]);
      
      // Apply corner cutting to generate smoother intermediate points
      for (let i = 0; i < result.length - 1; i++) {
        const p0 = result[i];
        const p1 = result[i + 1];
        
        // Q point (25% from p0 to p1)
        const qx = p0.x * 0.75 + p1.x * 0.25;
        const qy = p0.y * 0.75 + p1.y * 0.25;
        
        // R point (75% from p0 to p1)
        const rx = p0.x * 0.25 + p1.x * 0.75;
        const ry = p0.y * 0.25 + p1.y * 0.75;
        
        smoothed.push({ x: qx, y: qy });
        smoothed.push({ x: rx, y: ry });
      }
      
      // Always keep the last point
      smoothed.push(result[result.length - 1]);
      
      // Use the smoothed points for the next iteration
      result = smoothed;
    }
    
    return result;
  }

  /**
   * Calculates a path through a set of points using different curve types
   * Applies smoothing for all curve types
   * @param points Array of 2D points
   * @returns Path2D object for rendering
   */
  private calculatePath(points: Point2D[]): Path2D {
    const path = new Path2D();

    if (points.length < 2) {
      return path;
    }    
    const curveType = this.params.curveType;
    
    // Apply smoothing with different intensity based on curve type
    let smoothedPoints: Point2D[];
    if (curveType === "linear") {
      // For linear, apply minimal smoothing
      smoothedPoints = this.smoothPoints(points, 1);
    } else if (curveType === "quadratic") {
      // For quadratic, apply moderate smoothing
      smoothedPoints = this.smoothPoints(points, 2);
    } else {
      // For cubic, apply more smoothing iterations
      smoothedPoints = this.smoothPoints(points, 2);
    }
    
    // Draw the curves based on curve type
    if (curveType === "linear") {
      // Enhanced linear approach - still uses lineTo but with smoothed points
      path.moveTo(smoothedPoints[0].x, smoothedPoints[0].y);
      for (let i = 1; i < smoothedPoints.length; i++) {
        path.lineTo(smoothedPoints[i].x, smoothedPoints[i].y);
      }
      this.closePathIfNeeded(path, smoothedPoints);
    } 
    else if (curveType === "quadratic") {
      const controlFactor = 0.12; // Slightly increased for smoother curves

      path.moveTo(smoothedPoints[0].x, smoothedPoints[0].y);
      for (let i = 0; i < smoothedPoints.length - 1; i++) {
        const p1 = smoothedPoints[i];
        const p2 = smoothedPoints[i+1];

        // Improved midpoint calculation with offset
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // Perpendicular offset for the control point
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const cpx = midX + dy * controlFactor;
        const cpy = midY - dx * controlFactor;

        path.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
      }

      // Special handling for quadratic curves with path closing
      if (JOIN_CURVE_ENDS && smoothedPoints.length > 2) {
        const pLast = smoothedPoints[smoothedPoints.length - 1];
        const pFirst = smoothedPoints[0];

        const midX = (pLast.x + pFirst.x) / 2;
        const midY = (pLast.y + pFirst.y) / 2;

        const dx = pFirst.x - pLast.x;
        const dy = pFirst.y - pLast.y;
        const cpx = midX + dy * controlFactor;
        const cpy = midY - dx * controlFactor;

        path.quadraticCurveTo(cpx, cpy, pFirst.x, pFirst.y);
        path.closePath();
      } 
      else {
        this.closePathIfNeeded(path, smoothedPoints);
      }
    } 
    else { // "cubic" - highest quality curves
      // Improved control point factor
      const controlPointFactor = 0.3; // Reduced from 0.8 for smoother transition

      path.moveTo(smoothedPoints[0].x, smoothedPoints[0].y);
      
      // For better cubic Bezier results with 3+ points, use the previous and next points
      // to determine control points when possible
      for (let i = 0; i < smoothedPoints.length - 1; i++) {
        const p1 = smoothedPoints[i];
        const p2 = smoothedPoints[i+1];
        
        let cp1x, cp1y, cp2x, cp2y;
        
        if (i > 0 && i < smoothedPoints.length - 2) {
          // Use points before and after for better tangent approximation
          const p0 = smoothedPoints[i-1];
          const p3 = smoothedPoints[i+2];
          
          // Calculate tangent directions based on surrounding points
          const dx1 = p2.x - p0.x;
          const dy1 = p2.y - p0.y;
          const dx2 = p3.x - p1.x;
          const dy2 = p3.y - p1.y;
          
          // Scale the tangent vectors
          cp1x = p1.x + dx1 * controlPointFactor;
          cp1y = p1.y + dy1 * controlPointFactor;
          cp2x = p2.x - dx2 * controlPointFactor;
          cp2y = p2.y - dy2 * controlPointFactor;
        } else {
          // Fall back to simpler method for edge points
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;

          cp1x = p1.x + dx * controlPointFactor;
          cp1y = p1.y + dy * controlPointFactor;
          cp2x = p2.x - dx * controlPointFactor;
          cp2y = p2.y - dy * controlPointFactor;
        }

        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }

      // Special handling for cubic curves with path closing
      if (JOIN_CURVE_ENDS && smoothedPoints.length > 2) {
        const pLast = smoothedPoints[smoothedPoints.length - 1];
        const pFirst = smoothedPoints[0];
        const pSecond = smoothedPoints[1];
        
        // For closing the path, use the second point to calculate tangent
        const dx1 = pSecond.x - pLast.x;
        const dy1 = pSecond.y - pLast.y;
        
        const cp1x = pLast.x + dx1 * controlPointFactor;
        const cp1y = pLast.y + dy1 * controlPointFactor;
        const cp2x = pFirst.x - dx1 * controlPointFactor;
        const cp2y = pFirst.y - dy1 * controlPointFactor;

        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pFirst.x, pFirst.y);
        path.closePath();
      } 
      else {
        this.closePathIfNeeded(path, smoothedPoints);
      }
    }

    return path;
  }

  /**
   * Renders a particle with opacity based on its energy level
   * @param ctx Canvas rendering context
   * @param position Position to render the particle
   * @param opacity Base opacity value
   * @param particle Optional particle object for energy-based rendering
   * @param size Size of the particle 
   */
  private renderParticle(
    ctx: CanvasRenderingContext2D,
    position: Point2D,
    opacity: number,
    particle?: Particle,
    size: number = 4.0
  ): void {
    // If we have a particle with energy data, use that to adjust opacity
    let finalOpacity = opacity;
    if (particle) {
      // Use particle's energy level directly
      const energyRatio = particle.energy / particle.initialEnergy;
      finalOpacity = energyRatio * 0.8; // Slightly brighter than the base opacity
    } else {
      // Use passed opacity as fallback
      finalOpacity = opacity * 0.6;
    }
    
    // Draw a filled circle for the particle
    ctx.beginPath();
    ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(254, 58, 0, ${finalOpacity})`;
    ctx.fill();
  }
  
  /**
   * Renders glowing oval segments based on collision data
   */
  private renderOvalGlow(ctx: CanvasRenderingContext2D, timestamp: number) {
    if (!this.ovalBody || !this.params.showOval) return;
    
    // Get all segments of the oval
    const segments = Matter.Composite.allBodies(this.ovalBody);
    
    // Filter out old glows based on decay rate
    const now = timestamp;
    
    // Process each segment glow - remove glows older than 5 seconds
    this.segmentGlows = this.segmentGlows.filter(glow => {
      const age = (now - glow.lastUpdateTime) / 1000;
      return age < 5;
    });
    
    // Get the center of the canvas (to calculate the oval center)
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    // Find the actual oval center based on the oval position parameter
    const ovalCenterX = this.canvas.width * this.params.ovalPosition;
    
    // Calculate major and minor axis for the oval
    const majorAxis = this.canvas.width * 0.9; 
    const minorAxis = majorAxis * (1 - this.params.ovalEccentricity * 0.8);
    
    // Calculate a smooth oval path using many more points than segments
    // This avoids the zigzag and ensures a perfect elliptical shape
    ctx.beginPath();
    
    // Use 100 points for a smooth oval outline
    const numPoints = 100;
    for (let i = 0; i <= numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const x = ovalCenterX + (majorAxis / 2) * Math.cos(angle);
      const y = centerY + (minorAxis / 2) * Math.sin(angle);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    // Close the path
    ctx.closePath();
    
    // No stroke for the base outline - just a subtle fill
    // Use a color that contrasts with pink - a subtle teal/turquoise
    ctx.fillStyle = 'rgba(30, 140, 160, 0.06)'; // Very subtle teal fill
    ctx.fill();
    
    // Process active segment glows
    // Group glows by proximity to optimize rendering
    const activeGlowMap = new Map<number, { intensity: number, vertices: Matter.Vector[] }>();
    
    // Process each segment with active glow
    segments.forEach(segment => {
      // Find the glow for this segment
      const glow = this.segmentGlows.find(g => g.segmentId === segment.id);
      
      if (!glow) return;
      
      // Calculate how old this glow is in seconds
      const glowAge = (now - glow.lastUpdateTime) / 1000;
      
      // Apply exponential decay to the intensity
      const currentIntensity = glow.intensity * Math.exp(-7 * glowAge);
      
      // Skip segments with very low intensity
      if (currentIntensity < 0.05) return;
      
      // Get segment angle (0-360 degrees, quantized to nearest 10 degrees)
      const segmentCenterX = (segment.vertices[0].x + segment.vertices[2].x) / 2;
      const segmentCenterY = (segment.vertices[0].y + segment.vertices[2].y) / 2;
      const angle = Math.atan2(segmentCenterY - centerY, segmentCenterX - ovalCenterX);
      const angleDegrees = Math.round((angle * 180 / Math.PI) / 10) * 10;
      
      // Use angle as key to group nearby segments
      if (activeGlowMap.has(angleDegrees)) {
        // Combine with existing glow for this angle (take max intensity)
        const existing = activeGlowMap.get(angleDegrees)!;
        existing.intensity = Math.max(existing.intensity, currentIntensity);
      } else {
        // Add new glow for this angle
        activeGlowMap.set(angleDegrees, {
          intensity: currentIntensity,
          vertices: segment.vertices
        });
      }
    });
    
    // Draw each glow region with appropriate intensity
    activeGlowMap.forEach((glowData, angleDegrees) => {
      const { intensity, vertices } = glowData;
      
      // Calculate angle in radians
      const angleRadians = angleDegrees * Math.PI / 180;
      
      // Create an arc segment around the collision point
      ctx.beginPath();
      
      // Calculate the arc width - wider for stronger collisions
      const arcWidth = Math.PI / 8 + (intensity / 10) * (Math.PI / 10); // 22.5 to 40.5 degrees
      
      // Draw an arc along the ellipse at the collision point
      // We need to parameterize the ellipse correctly
      const numArcPoints = 20;
      
      for (let i = 0; i <= numArcPoints; i++) {
        const t = angleRadians - arcWidth/2 + (i / numArcPoints) * arcWidth;
        const x = ovalCenterX + (majorAxis / 2) * Math.cos(t);
        const y = centerY + (minorAxis / 2) * Math.sin(t);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      // Enhanced opacity scaling for more dramatic effects
      // Use a power function to emphasize higher intensities
      const intensityPower = Math.pow(intensity, 1.2);
      
      // Scale opacity with enhanced range
      const fillOpacity = Math.min(intensityPower * 2.2, 0.98);
      
      // Dynamic color based on intensity - from soft pink to bright hot pink
      const r = 255;
      const g = Math.max(20, Math.min(160, 105 + intensityPower * 55));
      const b = Math.max(147, Math.min(230, 180 + intensityPower * 50));
      
      // Create a gradient for more natural glow appearance
      const gradientRadius = 40 + intensityPower * 20; // Dynamic radius
      
      // Calculate point on oval for gradient center
      const gradientX = ovalCenterX + (majorAxis / 2) * Math.cos(angleRadians);
      const gradientY = centerY + (minorAxis / 2) * Math.sin(angleRadians);
      
      const gradient = ctx.createRadialGradient(
        gradientX, gradientY, 0,
        gradientX, gradientY, gradientRadius
      );
      
      // Inner color (more opaque)
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${fillOpacity})`);
      // Outer color (transparent)
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Add a subtle outer glow for high-intensity collisions
      if (intensityPower > 0.7) {
        // Outer glow with low opacity
        ctx.shadowColor = `rgba(255, 50, 160, ${intensityPower * 0.8})`;
        ctx.shadowBlur = 8 + intensityPower * 7; // Dynamic blur based on intensity
        ctx.strokeStyle = `rgba(255, 50, 180, ${intensityPower * 0.4})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        
        // Reset shadow to avoid affecting other rendering
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
    });
  }

  /**
   * Applies a motion blur effect by drawing multiple semi-transparent
   * strokes with slight offsets and varying thickness
   * @param ctx Canvas context
   * @param path Path to draw
   * @param color Base color (rgb values)
   * @param opacity Base opacity
   * @param baseWidth Base line width
   * @param trailFactor How far the motion trail extends 
   * @param direction Direction of motion (normalized vector)
   */
  private applyMotionBlur(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    color: { r: number, g: number, b: number },
    opacity: number,
    baseWidth: number,
    trailFactor: number = 3,
    direction: { x: number, y: number } = { x: 1, y: 0 }
  ): void {
    // Save context state
    ctx.save();
    
    // For performance, limit blur layers
    const blurLayers = 3;
    
    // Main stroke (most visible)
    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
    ctx.lineWidth = baseWidth;
    ctx.stroke(path);
    
    // Motion blur/trail layers
    for (let i = 1; i <= blurLayers; i++) {
      // Decrease opacity as we go back in the trail
      const layerOpacity = opacity * (1 - (i / blurLayers) * 0.8);
      
      // Decrease width as we go back
      const layerWidth = baseWidth * (1 - (i / blurLayers) * 0.5);
      
      // Set the style for this layer
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${layerOpacity})`;
      ctx.lineWidth = layerWidth;
      
      // Calculate offset based on direction and trail factor
      const offsetX = -direction.x * i * trailFactor; 
      const offsetY = -direction.y * i * trailFactor;
      
      // Apply translation, draw, then reset
      ctx.translate(offsetX, offsetY);
      ctx.stroke(path);
      ctx.translate(-offsetX, -offsetY);
    }
    
    // Restore context
    ctx.restore();
  }

  /**
   * Renders a wavefront path with motion blur effect
   */
  private renderWaveFrontPath(
    ctx: CanvasRenderingContext2D, 
    path: Path2D, 
    waveFront: WaveFront, 
    renderParams: RenderParams
  ): void {
    const { power } = renderParams;
    const { baseOpacity, thicknessFactor, energy, waveIndex } = waveFront;

    // Energy factor determines all visual properties
    const energyFactor = energy / (power || 1);
    
    // Calculate motion blur direction based on wavefront index
    // Positive indices are moving right, negative indices are moving left
    const isMovingRight = waveIndex < 4; // First 4 ranges are positive dot products
    const direction = { 
      x: isMovingRight ? 1 : -1, 
      y: 0 
    };

    // Base width for the line
    const baseWidth = energyFactor * thicknessFactor * CanvasController.BASE_LINE_WIDTH * 0.5;
    
    // Apply motion blur with primary color
    const primaryColor = { r: 20, g: 210, b: 255 }; // Bright blue
    const adjustedOpacity = baseOpacity * 0.7; // Slightly more transparent for better blur effect
    
    // Apply blur with stronger effect for high energy waves
    const trailFactor = energyFactor > 0.5 ? 4 : 2;
    
    this.applyMotionBlur(
      ctx, 
      path, 
      primaryColor, 
      adjustedOpacity, 
      baseWidth, 
      trailFactor,
      direction
    );

    // Add a secondary glow effect for high energy waves
    if (energyFactor > 0.8) {
      const secondaryColor = { r: 160, g: 240, b: 255 }; // Lighter blue
      const secondaryOpacity = adjustedOpacity * 0.6;
      const secondaryWidth = baseWidth * 0.4; // Thinner secondary stroke
      
      this.applyMotionBlur(
        ctx, 
        path, 
        secondaryColor, 
        secondaryOpacity, 
        secondaryWidth,
        trailFactor * 0.5, // Less trail for secondary effect
        direction
      );
    }
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
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Single activation line without glow effect
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.15)";
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }


  setRTL(enabled: boolean) {
    this.isRTL = enabled;
    // No need to modify physics - we'll handle this in the render phase
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  setShowParticles(show: boolean) {
    this.showParticles = show;
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  updateParams(params: AnimationParams) {
    const prevShowOval = this.params.showOval;
    const prevPosition = this.params.ovalPosition;
    const prevEccentricity = this.params.ovalEccentricity;
    const prevCurveType = this.params.curveType;

    this.params = params;

    // Check if oval-related parameters have changed
    const ovalChanged = prevShowOval !== params.showOval || 
                        prevPosition !== params.ovalPosition || 
                        prevEccentricity !== params.ovalEccentricity;

    // Check if visualization parameters have changed
    const visualChanged = prevCurveType !== params.curveType;

    if (ovalChanged) {
      // If position changed, but eccentricity stayed the same, we can optimize
      const eccentricityChanged = prevEccentricity !== params.ovalEccentricity;

      // If we need to create a new oval, delete the old one first
      if (this.ovalBody && (eccentricityChanged || prevShowOval !== params.showOval)) {
        Matter.Composite.remove(this.engine.world, this.ovalBody);
        this.ovalBody = null;
      }

      this.updateOval();
    }

    // Redraw the frame if any parameters changed and animation is not running
    if ((ovalChanged || visualChanged) && this.animationFrame === null) {
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
    const wallThickness = 13;
    const ovalBody = Matter.Composite.create();


    const segments = 55;

    for (let i = 0; i < segments; i++) {
      // Calculate current angle and next angle
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;

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
    const majorAxis = width * 0.9; 
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

  play() {
    if (this.animationFrame !== null) return;
    this.startTime = performance.now();
    this.animate();
  }

  pause() {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.startTime = null;
  }

  cleanup() {
    this.pause();
    Matter.Engine.clear(this.engine);
    Matter.World.clear(this.engine.world, false);
  }

  private drawFrame(progress: number) {
    // Define width and height variables that can be used throughout this method
    const width = this.canvas.width;
    const height = this.canvas.height

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
    const bufferMargin = 20; // Increased margin to prevent abrupt changes (20px → 50px)
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

          // If we have enough particles, use wave front rendering
          if (visibleParticles.length > 3) {
            // =====================================
            // Step 4: Calculate wave fronts using our dedicated function
            // =====================================
            const waveFronts = this.calculateWaveFronts([bubble], screenBounds);

            // Prepare rendering parameters
            const renderParams: RenderParams = {
              showShadow: this.params.power > 1,
              power: this.params.power,
              screenBounds
            };

            // Process each wave front
            for (const waveFront of waveFronts) {
              if (waveFront.points.length < 2) continue;

              // =====================================
              // Step 5: Calculate the path once using our path generation function
              // =====================================
              const path = this.calculatePath(waveFront.points);

              // =====================================
              // Step 6: Render the path with appropriate styling using our rendering function
              // =====================================
              // Only render wave paths in non-glow mode
              if (this.params.curveType !== 'glow') {
                this.renderWaveFrontPath(this.ctx, path, waveFront, renderParams);
              }
            }

            // Draw individual particles if needed
            if (this.showParticles) {
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                // Pass the particle object to use its energy for rendering
                this.renderParticle(this.ctx, pos, opacity, particle);
              });
            }
          } 
          // If we have some particles but not enough for a curve, draw simple lines
          else if (visibleParticles.length > 1) {
            this.ctx.beginPath();
            const baseOpacity = bubble.energy / bubble.initialEnergy;
            const lineOpacity = baseOpacity * 0.4;
            this.ctx.strokeStyle = `rgba(0, 200, 255, ${lineOpacity})`;
            this.ctx.lineWidth = 0.8;

            for (let i = 0; i < visibleParticles.length - 1; i++) {
              const pos1 = visibleParticles[i].body.position;
              const pos2 = visibleParticles[i + 1].body.position;
              this.ctx.moveTo(pos1.x, pos1.y);
              this.ctx.lineTo(pos2.x, pos2.y);
            }

            this.ctx.stroke();

            // Also draw the particle dots if showParticles is true
            if (this.showParticles) {
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                // Pass the particle object to use its energy for rendering
                this.renderParticle(this.ctx, pos, opacity, particle);
              });
            }
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
      if (this.params.curveType === 'glow') {
        // In glow mode, render the glow effect on oval segments
        this.renderOvalGlow(this.ctx, performance.now());
      } else {
        const bodies = Matter.Composite.allBodies(this.ovalBody);
  
        this.ctx.beginPath();

        bodies.forEach(body => {
          const vertices = body.vertices;
          this.ctx.moveTo(vertices[0].x, vertices[0].y);
          
          for (let i = 1; i < vertices.length; i++) {
            this.ctx.lineTo(vertices[i].x, vertices[i].y);
          }
          
          // Connect to the first vertex to close this segment
          this.ctx.lineTo(vertices[0].x, vertices[0].y);
        });
  
        // Simple outline stroke without fill
        this.ctx.strokeStyle = 'rgba(220, 50, 255, 0.4)';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      }
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