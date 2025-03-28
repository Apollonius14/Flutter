import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  groupId: number;
  cycleNumber: number;
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

export class CanvasController {
  // Core timing constants
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.44; // Cycle duration in milliseconds
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 12; // How many cycles particles live
  private static readonly PHYSICS_TIMESTEP_MS: number = 12.5; // Physics engine update interval (80fps)
  // Layout constants
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; // 30% of canvas width
  private static readonly DEFAULT_GAP_SIZE: number = 0.4; // Default gap size (fraction of canvas height)
  private static readonly WALL_THICKNESS: number = 12; // Thickness of the funnel walls
  // Particle appearance constants
  private static readonly OPACITY_DECAY_RATE: number = 0.01; // How much opacity decreases per cycle
  private static readonly BASE_LINE_WIDTH: number = 2.7; // Base thickness for particle trails
  private static readonly PARTICLES_PER_RING: number = 17; // Number of particles in each ring
  private static readonly PARTICLE_RADIUS: number = 0.5; // Physics body radius for particles
  private static readonly FIXED_BUBBLE_RADIUS: number = 7.2; // Fixed radius for bubbles

  // State variables
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWidth: number;
  private canvasHeight: number;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];
  private funnelEnabled: boolean = true;
  private engine: Matter.Engine;
  private funnelWalls: Matter.Body[] = [];
  private previousSweepLineX: number = 0;
  private activationLineX: number = 0;
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000;
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null;
  private wallCurvature: number = 0;
  private gapSize: number = CanvasController.DEFAULT_GAP_SIZE;
  private topWallAngle: number = 0;
  private bottomWallAngle: number = 0;
  private currentGroupId: number = 0;
  private currentCycleNumber: number = 0;
  private positions: number[] = [];
  private isRTL: boolean = false;
  private showParticles: boolean = true;
  private curveLogic: 'ByBubble' | 'ByDirection' = 'ByBubble';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 3,
      velocityIterations: 3,
      constraintIterations: 2,
    }); 
    this.params = {
      power: 12,
      frequency: 0.3
    };

    this.activationLineX = canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';

    setTimeout(() => {
      this.setupFunnelWalls();
    }, 0);
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

    // Increased thickness factors for more visual distinction between waves
    if (centralPositions.includes(waveIndex)) return 3.0;    // Was 1.8
    if (innerPositions.includes(waveIndex)) return 2.4;      // Was 1.6
    if (middlePositions.includes(waveIndex)) return 1.8;     // Was 1.3
    if (outerPositions.includes(waveIndex)) return 1.2;      // Was 1.05
    if (farthestPositions.includes(waveIndex)) return 0.8;   // Was 1.0

    return 0.8;
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
      const transformedAngle = angle * (1 - 0.5 * compressionFactor);
      const normalizedAngle = (transformedAngle + 2 * Math.PI) % (2 * Math.PI);

      particleAngles.push(normalizedAngle);
    }

    return particleAngles.sort((a, b) => a - b);
  }

  private setupFunnelWalls() {
    // Clean up existing walls first
    this.funnelWalls.forEach(wall => {
      Matter.Composite.remove(this.engine.world, wall);
    });
    this.funnelWalls = [];

    if (!this.funnelEnabled) return;

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    const centerY = height * 0.5;
    const gapSize = height * this.gapSize; // Use the stored gap size
    const wallThickness = CanvasController.WALL_THICKNESS; // Use our constant
    const wallLength = height * 2; // Make walls much longer to ensure complete blockage at minimum gap

    // Set up walls as static bodies with enhanced collision properties
    const wallOptions = {
      isStatic: true,
      restitution: 1.0, // Perfect elasticity (no energy loss)
      friction: 0.0,    // No friction to prevent energy loss during sliding contacts
      frictionStatic: 0.0, // No static friction 
      frictionAir: 0,   // No air friction
      slop: 0.02,
      // Using Matter.js default slop value
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001
      }
    };

    // Calculate wall angles - this is key for the angle-based rotation
    const wallAngleRadians = (this.wallCurvature * 90) * (Math.PI / 180);
    this.topWallAngle = -wallAngleRadians;
    this.bottomWallAngle = wallAngleRadians;

    // Create the walls
    const topWall = Matter.Bodies.rectangle(
      midX,
      centerY - gapSize/2 - wallLength/2,
      wallThickness,
      wallLength,
      wallOptions
    );

    const bottomWall = Matter.Bodies.rectangle(
      midX,
      centerY + gapSize/2 + wallLength/2,
      wallThickness,
      wallLength,
      wallOptions
    );

    // Apply rotation to the walls directly
    Matter.Body.setAngle(topWall, this.topWallAngle);
    Matter.Body.setAngle(bottomWall, this.bottomWallAngle);

    // Store walls for reference
    this.funnelWalls = [topWall, bottomWall];

    // Add walls to the physics world
    Matter.Composite.add(this.engine.world, this.funnelWalls);
  }

  /**
   * Calculate wave positions across the canvas height
   */
  private calculateWavePositions(canvasHeight: number): number[] {
    const positions: number[] = [];
    const compressionFactor = 0.585;
    const center = canvasHeight / 2;
    const numPositions = 9; 
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 1);
    const halfSpacing = baseSpacing / 2;

    // Add positions from top to bottom, offset from center
    positions.push(center - halfSpacing - baseSpacing * 4);
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center - halfSpacing);
    positions.push(center + halfSpacing);
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
    const fixedRadius = CanvasController.FIXED_BUBBLE_RADIUS;

    // Calculate wave positions using our helper method
    this.positions = this.calculateWavePositions(height);

    // Always use the activation line position for spawning particles
    // This ensures particles only appear at the activation line
    x = this.activationLineX;


    this.positions.forEach(y => {
      
      const intensity = 2.0;

      // Generate a unique group ID for this ring of particles
      const groupId = this.currentGroupId++;

      const particles: Particle[] = [];
      // Use our constant for the number of particles per ring
      const numParticlesInRing = CanvasController.PARTICLES_PER_RING;

      // Keep track of power factor for maxAge calculation
      const particlePowerFactor = this.params.power / 3; // Adjusted for new triple lifetime

      // Generate the particle angles using our helper method
      const particleAngles = this.generateParticleAngles(numParticlesInRing);

      // Create particles at the calculated angles
      for (const angle of particleAngles) {
        const particleX = x + Math.cos(angle) * fixedRadius;
        const particleY = y + Math.sin(angle) * fixedRadius;

        // Create physics body with size from our constant
        const body = Matter.Bodies.circle(particleX, particleY, CanvasController.PARTICLE_RADIUS, {
          friction: 0.0,     // No friction to match walls and prevent energy loss 
          restitution: 1.0,  // Perfect elasticity (no energy loss)
          mass: 0.2,         // Increased mass to make particles less likely to squeeze through
          frictionAir: 0,    // No air resistance
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,
            group: -1
          }
        });

        const baseSpeed = 1.5; 
        const horizontalAlignment = Math.abs(Math.cos(angle));

        const directedSpeed = baseSpeed * (1 + 0.3 * horizontalAlignment);

        // Set velocity - still using the original angle, but with adjusted speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * directedSpeed,
          y: Math.sin(angle) * directedSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        // Create a properly typed particle with cycle number
        const particle: Particle = {
          body,
          intensity: intensity,
          groupId: groupId,  // Assign the same group ID to all particles in this ring
          cycleNumber: this.currentCycleNumber  // Assign current cycle number
        };
        particles.push(particle);
        }

      bubbles.push({
        x,
        y,
        radius: fixedRadius,
        initialRadius: fixedRadius,
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
   * Helper method to draw a Bézier curve through a set of particles
   */
  private drawBezierCurve(particles: Particle[], bubble: Bubble) {
    // Calculate power factor for drawing
    const drawPowerFactor = this.params.power / 3;

    // Draw a glow effect for the curve first
    // Add motion blur effect by drawing multiple semi-transparent layers
    for (let blur = 6; blur >= 0; blur--) {
      this.ctx.beginPath();
      const baseOpacity = bubble.energy / bubble.initialEnergy;
      const currentOpacity = baseOpacity * (1 - blur * 0.2); // Fade out each blur layer

      // Only use shadow effect for higher power levels to save rendering time
      if (this.params.power > 1) {
        this.ctx.shadowColor = 'rgba(0, 220, 255, 0.5)';
        this.ctx.shadowBlur = 8 * drawPowerFactor;
      } else {
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
      }
      this.ctx.strokeStyle = `rgba(20, 210, 255, ${currentOpacity})`;

      // Calculate thickness based on wave position and energy
      const energyFactor = bubble.energy / bubble.initialEnergy;
      
      // Get position index from positions array
      const waveIndex = this.positions.indexOf(bubble.y);
      const thicknessFactor = this.calculateThicknessFactor(waveIndex);

      // Apply both factors to stroke width
      this.ctx.lineWidth = energyFactor * thicknessFactor;

      // Start at the first particle
      const startPos = particles[0].body.position;
      this.ctx.moveTo(startPos.x, startPos.y);

      // Use cubic bezier curves to create a smooth path through all particles
      for (let i = 0; i < particles.length - 1; i++) {
        const p0 = particles[Math.max(0, i-1)].body.position;
        const p1 = particles[i].body.position;
        const p2 = particles[i+1].body.position;
        const p3 = particles[Math.min(particles.length-1, i+2)].body.position;

        // Calculate control points for the current segment (p1 to p2)
        // Use a portion of the vector from previous to next particle
        const controlPointFactor = 0.25; // Adjust this for tighter/looser curves

        // First control point - influenced by p0 and p2
        const cp1x = p1.x + (p2.x - p0.x) * controlPointFactor;
        const cp1y = p1.y + (p2.y - p0.y) * controlPointFactor;

        // Second control point - influenced by p1 and p3
        const cp2x = p2.x - (p3.x - p1.x) * controlPointFactor;
        const cp2y = p2.y - (p3.y - p1.y) * controlPointFactor;

        // Draw the cubic bezier curve
        this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }

      this.ctx.stroke();
    }
  }

  setFunnelEnabled(enabled: boolean) {
    this.funnelEnabled = enabled;
    this.setupFunnelWalls();
  }

  setWallCurvature(angle: number) {
    // Convert 0-90 angle to 0-1 normalized value for internal use
    this.wallCurvature = angle / 90;
    if (this.funnelEnabled) {
      this.setupFunnelWalls();
    }
  }

  setGapSize(size: number) {
    this.gapSize = size;
    if (this.funnelEnabled) {
      this.setupFunnelWalls();
    }
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
  
  setCurveLogic(logic: 'ByBubble' | 'ByDirection') {
    this.curveLogic = logic;
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  updateParams(params: AnimationParams) {
    this.params = params;
    this.drawFrame(0);
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

  private drawFunnelWalls() {
    if (this.funnelWalls.length !== 2) return;

    const [topWall, bottomWall] = this.funnelWalls;
      // Draw rectangular walls for straight walls
      const wallThickness = CanvasController.WALL_THICKNESS; // Use our constant for wall thickness

      // Get wall positions
      const topWallPos = topWall.position;
      const bottomWallPos = bottomWall.position;

      // Get wall dimensions
      const topWallBounds = topWall.bounds;
      const bottomWallBounds = bottomWall.bounds;
      const topWallHeight = topWallBounds.max.y - topWallBounds.min.y;
      const bottomWallHeight = bottomWallBounds.max.y - bottomWallBounds.min.y;

      // Draw top wall at its current position with rotation
      this.ctx.save();
      this.ctx.translate(topWallPos.x, topWallPos.y);
      this.ctx.rotate(topWall.angle); // Use the Matter.js body's current angle

      this.ctx.beginPath();
      this.ctx.rect(
        -wallThickness/2,
        -topWallHeight/2,
        wallThickness,
        topWallHeight
      );

      // Smoky white fill
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      this.ctx.fill();

      // White border
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      this.ctx.restore();

      // Draw bottom wall at its current position with rotation
      this.ctx.save();
      this.ctx.translate(bottomWallPos.x, bottomWallPos.y);
      this.ctx.rotate(bottomWall.angle); // Use the Matter.js body's current angle

      this.ctx.beginPath();
      this.ctx.rect(
        -wallThickness/2,
        -bottomWallHeight/2,
        wallThickness,
        bottomWallHeight
      );

      // Smoky white fill
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      this.ctx.fill();

      // White border
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      this.ctx.restore();
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
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.03)'; // Reduced from 0.06 to 0.03 (another 50% reduction)
    this.ctx.fillRect(0, 0, width, height);

    // Draw funnel walls with smoky white fill
    if (this.funnelEnabled) {
      this.drawFunnelWalls();
    }

    const timeX = width * progress;

    // Draw enhanced time indicator line with motion blur effect
    // First draw a wider, lower opacity blur for motion blur effect
    this.ctx.beginPath();
    this.ctx.moveTo(timeX - 3, 0);
    this.ctx.lineTo(timeX - 3, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    this.ctx.lineWidth = 6;
    this.ctx.stroke();

    // Second blur layer, closer to main line
    this.ctx.beginPath();
    this.ctx.moveTo(timeX - 1.5, 0);
    this.ctx.lineTo(timeX - 1.5, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    this.ctx.lineWidth = 4;
    this.ctx.stroke();

    // Main sweep line - thicker and brighter
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)"; // Increased brightness
    this.ctx.lineWidth = 2; // Thicker line
    this.ctx.stroke();

    // Draw enhanced activation line with subtle glow
    // First draw a wider, low opacity glow
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.03)";
    this.ctx.lineWidth = 4;
    this.ctx.stroke();

    // Main activation line
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.08)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

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

    // Limit physics calculations to on-screen elements
    const bufferMargin = 20; // Extra margin around screen to prevent abrupt changes
    const screenBounds = {
      min: { x: -bufferMargin, y: -bufferMargin },
      max: { x: this.canvas.width + bufferMargin, y: this.canvas.height + bufferMargin }
    };

    // Update and draw bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      //bubble.age++;

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
              mask: 0x0002, // Collide with walls
              group: -1 // Can collide with other particles
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
            // Optionally, make off-screen particles static to further reduce computation
            // Matter.Body.setStatic(particle.body, true);
          }
        });
      }

      if (this.funnelEnabled && bubble.particles.length > 0) {
        // Use energy for opacity control
        let opacity = bubble.energy / bubble.initialEnergy;
        
        // Skip rendering if no energy left
        if (opacity <= 0) {
          return true; // Skip rendering but keep for physics until properly cleaned up
        }

        // We no longer draw inactive particles - they're completely invisible
        // Only blue particles at the activation line are visible
        // For active particles, they'll be drawn with the bezier curves below
        // We skip drawing them here to avoid double-rendering

        // Draw particles with bezier curves using selected logic approach
        if (bubble.particles.length > 1) {
          // First filter for visible particles regardless of curve logic
          const visibleParticles = bubble.particles
            .filter(p => {
              // Get particles that are on screen
              const pos = p.body.position;
              return pos.x >= 0 && pos.x <= this.canvas.width && pos.y >= 0 && pos.y <= this.canvas.height;
            });

          if (visibleParticles.length > 2) {
            // Logic for drawing curves by bubble (original approach)
            if (this.curveLogic === 'ByBubble') {
              // Sort particles by angle around the bubble center (original approach)
              const sortedParticles = visibleParticles.sort((a, b) => {
                // Sort particles by angle around the center
                const aPos = a.body.position;
                const bPos = b.body.position;
                const aAngle = Math.atan2(aPos.y - bubble.y, aPos.x - bubble.x);
                const bAngle = Math.atan2(bPos.y - bubble.y, bPos.x - bubble.x);
                return aAngle - bAngle;
              });

              this.drawBezierCurve(sortedParticles, bubble);
            } 
            // Logic for drawing curves by direction (new approach)
            else if (this.curveLogic === 'ByDirection') {
              // Group particles by their direction based on dot product with positive x-axis
              const directionGroups: {[key: string]: Particle[]} = {};
              
              // Define non-linear bucket boundaries for horizontal motion emphasis
              // More buckets near horizontal (±1) and fewer in the middle (near 0)
              const bucketBoundaries = [
                -1.0, -0.95, -0.85, -0.70, -0.5, -0.2, 0.2, 0.5, 0.70, 0.85, 0.95, 1.0
              ];
              
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                const vel = particle.body.velocity;
                
                // Calculate dot product with positive x direction (1,0)
                // Normalize to get value between -1 and 1
                const magnitude = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
                if (magnitude === 0) return; // Skip stationary particles
                
                const dotProduct = vel.x / magnitude; // Dot product with (1,0) is just the x component
                
                // Find which bucket this particle belongs to
                let bucketIndex = 0;
                for (let i = 0; i < bucketBoundaries.length - 1; i++) {
                  if (dotProduct >= bucketBoundaries[i] && dotProduct < bucketBoundaries[i + 1]) {
                    bucketIndex = i;
                    break;
                  }
                }
                
                // Handle edge case for exactly 1.0
                if (dotProduct === 1.0) {
                  bucketIndex = bucketBoundaries.length - 2;
                }
                
                const bucketKey = bucketIndex.toString();
                
                if (!directionGroups[bucketKey]) {
                  directionGroups[bucketKey] = [];
                }
                directionGroups[bucketKey].push(particle);
              });
              
              // Draw each direction group as a separate Bézier curve
              Object.values(directionGroups).forEach(particles => {
                if (particles.length > 2) {
                  // Sort particles by y-position (top to bottom)
                  const sortedParticles = particles.sort((a, b) => 
                    a.body.position.y - b.body.position.y
                  );
                  
                  // Draw the curve using our helper method
                  this.drawBezierCurve(sortedParticles, bubble);
                }
              });
            }

            // Reset shadow effects after drawing all curves
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
          } else if (visibleParticles.length > 1) {
            // If we don't have enough points for a proper curve, fall back to lines
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
          }

          // Draw particles as bright neon pink circles if showParticles is true
          if (this.showParticles && visibleParticles.length > 0) {
            visibleParticles.forEach(particle => {
              const pos = particle.body.position;
              const cycleDiff = this.currentCycleNumber - bubble.cycleNumber;
              const particleSize = (cycleDiff / CanvasController.PARTICLE_LIFETIME_CYCLES) * 0.4;

              // Draw a filled circle with neon pink glow effect
              this.ctx.beginPath();
              this.ctx.arc(pos.x, pos.y, particleSize * 0.8, 0, Math.PI * 2);
              const opacity = bubble.energy / bubble.initialEnergy;
              this.ctx.fillStyle = `rgba(255, 50, 200, ${opacity * 0.6})`; // Neon pink, decays
              this.ctx.fill();
            });
          }
        }
      } 


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

    // Restore canvas state (important for RTL transformation)
    this.ctx.restore();
  }

  private animate() {
    if (!this.startTime) return;

    // Calculate time elapsed since last frame
    const elapsed = performance.now() - this.startTime;
    const cyclePeriod = CanvasController.CYCLE_PERIOD_MS;
    const currentCycleTime = Math.floor(elapsed / cyclePeriod);

    // Incrament Cycles
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
    this.updatePhysics(elapsed);
    this.drawFrame(progress);
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  private updatePhysics(timestamp: number) {
    // Update physics engine with appropriate resolution
    if (this.funnelEnabled) {
      // Use multiple smaller substeps for higher accuracy physics (especially for collisions)
      const numSubSteps = 6; 
      const subStepTime = CanvasController.PHYSICS_TIMESTEP_MS / numSubSteps;
      for (let i = 0; i < numSubSteps; i++) {
        Matter.Engine.update(this.engine, subStepTime);
      }
    } else {
      // Standard physics update when funnel is disabled
      Matter.Engine.update(this.engine, CanvasController.PHYSICS_TIMESTEP_MS);
    }

    // Update bubble energies
    this.bubbles.forEach(bubble => this.updateBubbleEnergy(bubble));
  }
}