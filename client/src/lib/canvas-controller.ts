import * as Matter from 'matter-js';

// Path rendering type - can be set to either "CUBIC" or "QUADRATIC"
// QUADRATIC is more performant but may look slightly less smooth
const BEZIER_CURVE_TYPE: "CUBIC" | "QUADRATIC" = "CUBIC";

// Control whether to join the last particle to the first in path calculations
const JOIN_CURVE_ENDS: boolean = false;

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; // Normalized position (0-1) for oval's horizontal position
  ovalEccentricity: number; // 0-1 value representing eccentricity
  curveType: "cubic" | "quadratic" | "linear" | "chaikin"; // Type of curve to use for rendering
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  groupId: number;
  cycleNumber: number;
  index: number; // Fixed index in the bubble's particles array
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  intensity: number;
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
  points: Point2D[];           // Sorted array of particle positions
  energy: number;              // Energy level for this wavefront
  waveIndex: number;           // Position index in the wave pattern
  thicknessFactor: number;     // Calculated thickness for this wavefront
  baseOpacity: number;         // Base opacity for this wavefront
  cycleNumber: number;         // The cycle number this wavefront belongs to
}

// Interface for rendering parameters
interface RenderParams {
  showShadow: boolean;         // Whether to show shadow effects
  power: number;               // Current power setting
  screenBounds: {              // Screen bounds for culling
    min: Point2D;
    max: Point2D;
  };
}

export class CanvasController {
  // Core timing constants
  private static readonly CYCLE_PERIOD_MS: number = 6667 ; // Cycle duration in milliseconds
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 3; // How many cycles particles live
  private static readonly PHYSICS_TIMESTEP_MS: number = 12; // Physics engine update interval (80fps)
  // Layout constants
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; // 30% of canvas width
  // Particle appearance constants
  private static readonly OPACITY_DECAY_RATE: number = 0.4; // How much opacity decreases per cycle
  private static readonly BASE_LINE_WIDTH: number = 1.0; // Reduced to 1.0 (5x thinner) as requested for debugging
  private static readonly PARTICLES_PER_RING: number = 14; // Number of particles in each ring
  private static readonly PARTICLE_RADIUS: number = 0.9; // Physics body radius for particles
  private static readonly FIXED_BUBBLE_RADIUS: number = 7.2; // Fixed radius for bubbles
  
  // Precomputed particle angles for better performance
  private static readonly PARTICLE_ANGLES: number[] = (() => {
    // This calculation is now done once at class initialization
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
      const absAngle = Math.abs(angle);
      const compressionFactor = (absAngle / Math.PI) * (absAngle / Math.PI);
      const transformedAngle = angle * (1 - 0.5 * compressionFactor);
      const normalizedAngle = (transformedAngle + 2 * Math.PI) % (2 * Math.PI);

      particleAngles.push(normalizedAngle);
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
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000;
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null;
  private frameCounter: number = 0;
  private currentGroupId: number = 0;
  private currentCycleNumber: number = 0;
  private positions: number[] = [];
  private isRTL: boolean = false;
  private showParticles: boolean = true;
  private ovalBody: Matter.Composite | null = null;

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
      constraintIterations: 2
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5, // Default to center
      ovalEccentricity: 0.7, // Default eccentricity
      curveType: "chaikin" // Default to Chaikin's algorithm for better performance
    };

    this.activationLineX = canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';
    
    // Initialize the oval if needed
    this.updateOval();
  }

  
  /**
   * Calculate thickness factor based on wave position
   * Enhanced to make differences between waves more pronounced
   */
  private calculateThicknessFactor(waveIndex: number): number {
    const centralPositions = [4, 5];
    const innerPositions = [3, 6];
    const middlePositions = [2, 7];
    const outerPositions = [1, 8];
    const farthestPositions = [0, 9];

    // More dramatic thickness differences for clearer wave visualization
    if (centralPositions.includes(waveIndex)) return 3.0;    // Increased from 2.0 to 3.0
    if (innerPositions.includes(waveIndex)) return 1.8;      // Increased from 1.4 to 1.8
    if (middlePositions.includes(waveIndex)) return 1.3;     // Slightly increased from 1.2
    if (outerPositions.includes(waveIndex)) return 0.7;      // Decreased from 0.9 to 0.7
    if (farthestPositions.includes(waveIndex)) return 0.5;   // Decreased from 0.8 to 0.5

    return 0.5; // Default for any other positions
  }

  /**
   * Generate particle angles for a wave ring with a forward-focused distribution
   */
  private generateParticleAngles(particleCount: number): number[] {
    const particleAngles: number[] = [];
    const baseAngles: number[] = [];
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
      const absAngle = Math.abs(angle);
      const compressionFactor = (absAngle / Math.PI) * (absAngle / Math.PI);
      const transformedAngle = angle * (1 - 0.5 * compressionFactor); // Added space around *
      const normalizedAngle = (transformedAngle + 2 * Math.PI) % (2 * Math.PI);

      particleAngles.push(normalizedAngle);
    }

    return particleAngles.sort((a, b) => a - b);
  };



  /**
   * Calculate wave positions across the canvas height
   */
  private calculateWavePositions(canvasHeight: number): number[] {
    const positions: number[] = [];
    // Keep the compression factor high to spread the 9 positions across the increased canvas height
    const compressionFactor = 0.1; // Higher value to use more vertical space
    const center = canvasHeight / 2;
    const numPositions = 9; // Back to the original 9 positions as requested
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 2);
    const halfSpacing = baseSpacing / 2;

    // Add positions from top to bottom, offset from center
    // Using exactly 9 positions but spread across the taller canvas
    positions.push(center - halfSpacing - baseSpacing * 4);
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center); // Center position (no offset)
    positions.push(center + halfSpacing + baseSpacing);
    positions.push(center + halfSpacing + baseSpacing * 2);
    positions.push(center + halfSpacing + baseSpacing * 3);
    positions.push(center + halfSpacing + baseSpacing * 4);

    return positions;
  }

  private generateBubbles(x: number): Bubble[] {
    const { power } = this.params;
    const height = this.canvas.height;
    const width = this.canvas.width;

    const bubbles: Bubble[] = [];
    const baseRadius = CanvasController.FIXED_BUBBLE_RADIUS;

    // Calculate wave positions using our helper method
    this.positions = this.calculateWavePositions(height);

    // Always use the activation line position for spawning particles
    // This ensures particles only appear at the activation line
    x = this.activationLineX;

    // Find the center position for radius calculation
    const centerY = height / 2;

    this.positions.forEach(y => {
      // Calculate a radius multiplier based on the distance from center
      // Use a cosine function to create a smooth bow curve
      // Normalize the position to be between -1 and 1, where 0 is center
      const normalizedPos = (y - centerY) / (height / 2);
      
      // Use cosine function to create a smooth curve, with center being largest
      // Multiplier will be between 0.7 (edges) and 2.1 (center) - 3x difference
      const radiusMultiplier = 0.7 + 1.4 * Math.cos(normalizedPos * Math.PI);
      
      // Apply the multiplier to get the actual radius for this position
      const bubbleRadius = baseRadius * radiusMultiplier;
      
      const intensity = 2.0;

      // Generate a unique group ID for this ring of particles
      const groupId = this.currentGroupId++;

      const particles: Particle[] = [];
      // Use our constant for the number of particles per ring
      const numParticlesInRing = CanvasController.PARTICLES_PER_RING;

      // Keep track of power factor for maxAge calculation
      const particlePowerFactor = this.params.power / 3; // Adjusted for new triple lifetime

      // Use precomputed angles instead of generating them each time
      const particleAngles = CanvasController.PARTICLE_ANGLES;

      // Create particles at the calculated angles
      particleAngles.forEach((angle, idx) => {
        const particleX = x + Math.cos(angle) * bubbleRadius;
        const particleY = y + Math.sin(angle) * bubbleRadius;

        // Create physics body with size from our constant
        const body = Matter.Bodies.circle(particleX, particleY, CanvasController.PARTICLE_RADIUS, {
          friction: 0.0,         // No surface friction
          frictionAir: 0.0,      // No air resistance
          frictionStatic: 0.0,   // No static friction
          restitution: 1.0,      // Perfect elasticity (no energy loss)
          mass:1,             // Light mass for responsive physics
          inertia: Infinity,
          slop: 0.01,            // Minimal slop for precise collisions
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,        // Only collide with the oval (0x0002), not other particles
            group: 0             // Using 0 instead of -1 to rely on mask for collision rules
          }
        });

        const baseSpeed = 0.5; 
        const horizontalAlignment = Math.abs(Math.cos(angle));

        const directedSpeed = baseSpeed * (1 + 1.1 * horizontalAlignment) ;

        // Set velocity - still using the original angle, but with adjusted speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * directedSpeed,
          y: Math.sin(angle) * directedSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        // Create a properly typed particle with cycle number and index
        const particle: Particle = {
          body,
          intensity: intensity,
          groupId: groupId,  // Assign the same group ID to all particles in this ring
          cycleNumber: this.currentCycleNumber,  // Assign current cycle number
          index: idx  // Assign fixed index based on position in the angle array
        };
        particles.push(particle);
      });

      bubbles.push({
        x,
        y,
        radius: bubbleRadius,
        initialRadius: bubbleRadius,
        intensity: intensity,
        particles,
        groupId: groupId,  // Assign the same group ID to the bubble
        cycleNumber: this.currentCycleNumber,  // Assign current cycle number
        energy: this.params.power,
        initialEnergy: this.params.power
      });
    });

    return bubbles;
  }

  private initializeBubble(x: number, y: number, intensity: number): Bubble {
    return {
      x,
      y,
      radius: CanvasController.FIXED_BUBBLE_RADIUS,
      initialRadius: CanvasController.FIXED_BUBBLE_RADIUS,
      intensity,
      particles: [],
      groupId: this.currentGroupId++,
      cycleNumber: this.currentCycleNumber,
      energy: this.params.power,
      initialEnergy: this.params.power,
    };
  }

  private updateBubbleEnergy(bubble: Bubble) {
    bubble.energy = Math.max(0, bubble.energy - (bubble.initialEnergy * 0.002));
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
        { min: 0.2, max: 0.3 },
        { min: 0.3, max: 0.4 },
        { min: 0.4, max: 0.6 },
        { min: 0.6, max: 1.0 },
        { min: -0.3, max: -0.2 },
        { min: -0.4, max: -0.3 },
        { min: -0.6, max: -0.4 },
        { min: -1.0, max: -0.6}
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
        
        // Calculate average energy and position index from constituent particles
        const avgEnergy = orderedParticles.reduce((sum, p) => sum + p.intensity, 0) / orderedParticles.length;
        
     
        const thicknessFactor = 2;
        const baseOpacity = 0.9; 
        waveFronts.push({
          points,
          energy: avgEnergy * 5, // Scale energy for visual effect
          waveIndex: directionIndex, // Use direction index for wave index
          thicknessFactor,
          baseOpacity,
          cycleNumber
        });
      }
    });
    
    return waveFronts;
  }
  
  /**
   * Generates a path through a set of points using cubic or quadratic Bézier curves, linear segments,
   * or Chaikin's corner cutting algorithm for smooth curves
   * Simplified version with fewer calculations for better performance
   * Uses the curveType parameter from AnimationParams
   * Optionally connects the last point back to the first based on JOIN_CURVE_ENDS setting
   */
  /**
   * Closes the path if JOIN_CURVE_ENDS is true
   * Helper method to reduce code duplication in path calculation
   */
  private closePathIfNeeded(path: Path2D, points: Point2D[]): void {
    if (JOIN_CURVE_ENDS) {
      if (points.length > 2) {
        // For complex paths, ensure we connect back to the start point
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

  private calculatePath(points: Point2D[]): Path2D {
    // Create a new path
    const path = new Path2D();
    
    // If not enough points, return empty path
    if (points.length < 2) {
      return path;
    }
    
    // If only two points, draw a straight line and close the path if JOIN_CURVE_ENDS is true
    if (points.length === 2) {
      path.moveTo(points[0].x, points[0].y);
      path.lineTo(points[1].x, points[1].y);
      this.closePathIfNeeded(path, points);
      return path;
    }
    
    // Use the curve type from params
    const curveType = this.params.curveType;
    
    if (curveType === "chaikin") {
      // Implementation of Chaikin's corner cutting algorithm
      // Create a closed loop of points for Chaikin's algorithm
      const closedPoints = [...points];
      
      // Only add the first point to close the loop if JOIN_CURVE_ENDS is true
      // and if the first and last points aren't already the same
      if (JOIN_CURVE_ENDS && 
          (points[0].x !== points[points.length - 1].x || points[0].y !== points[points.length - 1].y)) {
        closedPoints.push(points[0]);
      }
      
      // Apply Chaikin's algorithm with 3 iterations
      const iterations = 3;
      let currentPoints = closedPoints;
      
      for (let iter = 0; iter < iterations; iter++) {
        const newPoints: Point2D[] = [];
        
        // Process each edge to create two new points
        for (let i = 0; i < currentPoints.length - 1; i++) {
          const p0 = currentPoints[i];
          const p1 = currentPoints[i+1];
          
          // Cut corner at 1/4 and 3/4 marks
          // Q = 0.75 * P0 + 0.25 * P1
          // R = 0.25 * P0 + 0.75 * P1
          const qx = 0.75 * p0.x + 0.25 * p1.x;
          const qy = 0.75 * p0.y + 0.25 * p1.y;
          const rx = 0.25 * p0.x + 0.75 * p1.x;
          const ry = 0.25 * p0.y + 0.75 * p1.y;
          
          if (i === 0) {
            newPoints.push({ x: qx, y: qy });
          }
          newPoints.push({ x: rx, y: ry });
        }
        
        // Update points for next iteration
        currentPoints = newPoints;
      }
      
      // Draw the resulting smooth curve
      if (currentPoints.length > 0) {
        path.moveTo(currentPoints[0].x, currentPoints[0].y);
        for (let i = 1; i < currentPoints.length; i++) {
          path.lineTo(currentPoints[i].x, currentPoints[i].y);
        }
        this.closePathIfNeeded(path, currentPoints);
      }
    }
    else if (curveType === "linear") {
      // Simplest and fastest option: just draw straight lines
      path.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        path.lineTo(points[i].x, points[i].y);
      }
      this.closePathIfNeeded(path, points);
    } 
    else if (curveType === "quadratic") {
      // Quadratic curves - more efficient than cubic
      const controlFactor = 0.4; // Controls curve tightness
      
      path.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        
        // Simple midpoint calculation with offset
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        // Simple perpendicular offset for the control point
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const cpx = midX + dy * controlFactor;
        const cpy = midY - dx * controlFactor;
        
        path.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
      }
      
      // Special handling for quadratic curves with path closing
      if (JOIN_CURVE_ENDS && points.length > 2) {
        const pLast = points[points.length - 1];
        const pFirst = points[0];
        
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
        this.closePathIfNeeded(path, points);
      }
    } 
    else { // "cubic" - use only when needed for quality
      // Fixed control point factor
      const controlPointFactor = 0.4;
      
      path.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        
        // Simplified control points using just current and next point
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        
        const cp1x = p1.x + dx * controlPointFactor;
        const cp1y = p1.y + dy * controlPointFactor;
        const cp2x = p2.x - dx * controlPointFactor;
        const cp2y = p2.y - dy * controlPointFactor;
        
        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      
      // Special handling for cubic curves with path closing
      if (JOIN_CURVE_ENDS && points.length > 2) {
        const pLast = points[points.length - 1];
        const pFirst = points[0];
        
        const dx = pFirst.x - pLast.x;
        const dy = pFirst.y - pLast.y;
        
        const cp1x = pLast.x + dx * controlPointFactor;
        const cp1y = pLast.y + dy * controlPointFactor;
        const cp2x = pFirst.x - dx * controlPointFactor;
        const cp2y = pFirst.y - dy * controlPointFactor;
        
        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pFirst.x, pFirst.y);
        path.closePath();
      } 
      else {
        this.closePathIfNeeded(path, points);
      }
    }
    
    return path;
  }
  
  /**
   * Renders an individual particle with consistent styling
   * @param ctx Canvas rendering context
   * @param position Position of the particle
   * @param opacity Base opacity value
   * @param size Size of the particle to render
   */
  private renderParticle(
    ctx: CanvasRenderingContext2D,
    position: Point2D,
    opacity: number,
    size: number = 4.0
  ): void {
    // Draw a filled circle for the particle
    ctx.beginPath();
    ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(254, 58, 0, ${opacity * 0.6})`;
    ctx.fill();
  }

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
    
    // No shadows for better performance
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    // Make everything half as thick and twice as transparent
    const adjustedOpacity = baseOpacity * 0.8; // Half the opacity
    
    // Base blue color for all waves with adjusted opacity
    ctx.strokeStyle = `rgba(20, 210, 255, ${adjustedOpacity})`;
    ctx.lineWidth = energyFactor * thicknessFactor * CanvasController.BASE_LINE_WIDTH * 0.5; // Half as thick (1.5 * 0.5)
    ctx.stroke(path);
    
    // Add highlight layer for higher energy waves
    if (energyFactor > 0.8) {
      ctx.strokeStyle = `rgba(160, 240, 255, ${adjustedOpacity * 0.8})`;
      ctx.lineWidth = energyFactor * thicknessFactor * CanvasController.BASE_LINE_WIDTH * 0.2; // Half as thick (0.4 * 0.5)
      ctx.stroke(path);
    }
  }

  /**
   * Creates a physics body optimized for perfectly elastic collisions
   */
  private createPerfectlyElasticBody(
    x: number, 
    y: number, 
    radius: number, 
    collisionFilter: Matter.ICollisionFilter
  ): Matter.Body {
    // Create the body with precise collision parameters
    const body = Matter.Bodies.circle(x, y, radius, {
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      restitution: 1.0,
      inertia: Infinity,
      mass: 1,
      slop: 0.05,         // Reduced slop for more precise collisions 
      collisionFilter
    });
    
    // Set inertia to Infinity to prevent rotation which can cause energy loss
    Matter.Body.setInertia(body, Infinity);
    
    return body;
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
    // Wall thickness for the ring
    const wallThickness = 9;
    
    // Create a composite for all the small segments that will form our ring
    const ovalBody = Matter.Composite.create();
    
    // Increased number of segments for smoother collisions
    const segments = 29;
    
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
    const centerY = height / 2; // Always centered vertically
    const majorAxis = width * 0.8; 
    const minorAxis = majorAxis * (1 - this.params.ovalEccentricity * 0.8); // Eccentricity affects minor axis
    
    // If oval shouldn't be shown, remove it if it exists
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
    // This is more efficient than removing and recreating
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
          return true; // Skip rendering but keep for physics until properly cleaned up
        }

        // Draw all particles with bezier curves, using our modular approach
        if (bubble.particles.length > 1) {
          // Get visible particles for rendering
          const visibleParticles = bubble.particles.filter(p => {
            const pos = p.body.position;
            return pos.x >= 0 && pos.x <= this.canvas.width && 
                   pos.y >= 0 && pos.y <= this.canvas.height;
          });
          
          // If we have enough particles, use wave front rendering
          if (visibleParticles.length > 2) {
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
              this.renderWaveFrontPath(this.ctx, path, waveFront, renderParams);
            }
            
            // Draw individual particles if needed
            if (this.showParticles) {
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                this.renderParticle(this.ctx, pos, opacity);
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
                this.renderParticle(this.ctx, pos, opacity);
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
      // Since the oval is now a composite of multiple segments,
      // we need to iterate through each body in the composite
      const bodies = Matter.Composite.allBodies(this.ovalBody);
      
      // Draw the oval outline without glow effects
      this.ctx.beginPath();

      // Iterate through each segment body and draw it
      bodies.forEach(body => {
        const vertices = body.vertices;
        
        this.ctx.moveTo(vertices[0].x, vertices[0].y);
        
        for (let i = 1; i < vertices.length; i++) {
          this.ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        
        // Close the path for this segment
        this.ctx.lineTo(vertices[0].x, vertices[0].y);
      });
      
      // Simple solid stroke without shadows
      this.ctx.strokeStyle = 'rgba(220, 50, 255, 0.4)';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
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

      // Kill bubbles and their particles if they're too old

      // Remove particles from physics engine that are no longer in any bubble
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
    const numSubSteps = this.params.showOval ? 8 : 4; // Doubled substeps: 8 when oval present, 4 when not
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
