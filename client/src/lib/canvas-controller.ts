import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  age: number;
  groupId: number; // Group ID to identify particles in the same ring
  isOriginal: boolean; // Required for backward compatibility with existing code
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  age: number;
  maxAge: number;
  intensity: number;
  particles: Particle[];
  groupId: number; // Group ID to identify this bubble's particle group
  isOriginalSet: boolean; // Required for backward compatibility with existing code
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];
  private funnelEnabled: boolean = true;
  private engine: Matter.Engine;
  private funnelWalls: Matter.Body[] = [];
  private previousSweepLineX: number = 0; // Track previous position of sweep line
  private activationLineX: number = 0; // Will be set to 20% of canvas width
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000; // Default spawn interval in ms
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null; // Callback for cycle start
  private wallCurvature: number = 0; // 0 = straight wall, 1 = max curve
  private gapSize: number = 0.4; // Normalized gap size (fraction of canvas height)
  private topWallAngle: number = 0; // Store angle for top wall in radians
  private bottomWallAngle: number = 0; // Store angle for bottom wall in radians
  private currentGroupId: number = 0; // Counter for generating unique group IDs
  private positions: number[] = []; // Store wave positions
  private isRTL: boolean = false; // RTL mode toggle (right-to-left for Arabic)
  private showParticles: boolean = true; // Toggle to show/hide individual particles

  constructor(canvas: HTMLCanvasElement) {
    console.time('Canvas initialization');
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false }); // Disable alpha for better performance
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    // Configure engine with minimal iteration parameters for faster loading
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 3,  // Reduced by half for much faster startup
      velocityIterations: 3,  // Reduced by half for much faster startup 
      constraintIterations: 2  // Minimum value for fastest startup
    });

    this.params = {
      power: 12, // Doubled again from 6
      frequency: 0.15  // Default frequency from home.tsx
    };
    
    // Set the activation line at 20% of canvas width
    this.activationLineX = canvas.width * 0.2;
    
    // Calculate initial spawn interval based on frequency
    this.updateSpawnInterval();

    this.canvas.style.backgroundColor = '#1a1a1a';
    
    // Defer wall setup slightly for faster initial loading
    setTimeout(() => {
      this.setupFunnelWalls();
      
      // Setup collision detection only after walls are created
      this.setupCollisionDetection();
    }, 0);
    
    console.timeEnd('Canvas initialization');
  }
  
  // Extract collision detection setup to a separate method
  private setupCollisionDetection() {
    // Add collision handling to keep track of original vs collision-created particles
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // When collisions happen, mark the particles as non-original
      // This ensures we can tell the difference between original particles and those
      // that result from collisions
      event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        // Find the corresponding particles
        this.bubbles.forEach(bubble => {
          bubble.particles.forEach(particle => {
            if (particle.body === bodyA || particle.body === bodyB) {
              // Mark as non-original after collision
              particle.isOriginal = false;
            }
          });
        });
      });
    });
  }
  
  // Helper method to update spawn interval based on frequency
  private updateSpawnInterval() {
    // Lower frequency value = less frequent spawning = higher interval
    // Base interval now increased by 1.5x, then 1.2x, then 1.5x, and now by another 1.2x
    const baseInterval = 4000 / (1.5 * 1.2 * 1.9 * 1.2); // Increased frequency by an additional 20%
    this.spawnInterval = baseInterval * (1 - this.params.frequency/2);
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
    const wallThickness = 12; // Reduced from 20 to make walls more slender
    const wallLength = height * 2; // Make walls much longer to ensure complete blockage at minimum gap

    // Set up walls as static bodies with enhanced collision properties
    const wallOptions = {
      isStatic: true,
      restitution: 1.0, // Perfect elasticity (no energy loss)
      friction: 0.0,    // No friction to prevent energy loss during sliding contacts
      frictionStatic: 0.0, // No static friction 
      frictionAir: 0,   // No air friction
      density: 1,       // Standard density
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

  private generateBubbles(x: number): Bubble[] {
    const { power } = this.params;
    const centerY = this.canvas.height / 2;
    const height = this.canvas.height;
    const width = this.canvas.width;

    // Generate 7 waves (odd number for symmetry)
    const numWaves = 7;
    
    const bubbles: Bubble[] = [];
    const fixedRadius = 7.2;

    // Generate symmetrically distributed positions with even number of rings
    this.positions = []; // Clear previous positions
    const compressionFactor = 0.585; // Reduced by 10% from 0.65
    
    // Calculate center and offsets for symmetric distribution
    const center = height / 2;
    // Increased from 6 to 9 positions (50% more) for more planar wave appearance
    const numPositions = 9; 
    const baseSpacing = (height * compressionFactor) / (numPositions + 1);
    
    // Calculate offset to avoid placing ring directly on centerline
    const halfSpacing = baseSpacing / 2;
    
    // Add positions in order from top to bottom (all offset from center)
    // We're using 9 waves now with 4 above and 4 below the centerline (plus the offset)
    this.positions.push(center - halfSpacing - baseSpacing * 4); // Upper outer 4
    this.positions.push(center - halfSpacing - baseSpacing * 3); // Upper outer 3
    this.positions.push(center - halfSpacing - baseSpacing * 2); // Upper outer 2
    this.positions.push(center - halfSpacing - baseSpacing);     // Upper inner
    this.positions.push(center - halfSpacing);                   // Near-center upper
    this.positions.push(center + halfSpacing);                   // Near-center lower
    this.positions.push(center + halfSpacing + baseSpacing);     // Lower inner
    this.positions.push(center + halfSpacing + baseSpacing * 2); // Lower outer 2
    this.positions.push(center + halfSpacing + baseSpacing * 3); // Lower outer 3
    this.positions.push(center + halfSpacing + baseSpacing * 4); // Lower outer 4

    // Always use the activation line position for spawning particles
    // This ensures particles only appear at the activation line
    x = this.activationLineX;
    
    // All particles are active since we're only generating at the activation line
    const isActive = true;
    
    this.positions.forEach(y => {
      // Always create active blue particles
      const intensity = 1.0;

      // Generate a unique group ID for this ring of particles
      const groupId = this.currentGroupId++;
      
      const particles: Particle[] = [];
      // Reduced by 30% from 25 to 17 particles per ring (still odd for symmetry)
      // 25 * 0.7 = 17.5, rounded down to 17 to keep it odd
      const numParticlesInRing = 17;
      
      // Keep track of power factor for maxAge calculation
      const particlePowerFactor = this.params.power / 3; // Adjusted for new triple lifetime
      
      // Create an array to store the angles we'll use for particle placement
      const particleAngles: number[] = [];
      
      // Use exactly the number of particles specified (no probabilistic sampling)
      // This ensures we always have the same number of particles in each ring
      const exactParticleCount = numParticlesInRing;
      
      // Generate deterministic non-uniform angles to concentrate particles at the wavefront (right side)
      // First create a base array of uniformly distributed angles
      const baseAngles: number[] = [];
      
      // With odd number of particles, ensure one is exactly at 0°
      // Generate angles from -π to +π to ensure symmetry around 0
      const halfCount = Math.floor(exactParticleCount / 2);
      
      // Add the center particle at exactly 0° (right in the middle)
      baseAngles.push(0);
      
      // Add symmetric pairs of particles on each side of 0°
      for (let i = 1; i <= halfCount; i++) {
        const angle = (i / halfCount) * Math.PI; // Goes from 0 to π
        baseAngles.push(angle);    // Add positive angle (below centerline)
        baseAngles.push(-angle);   // Add negative angle (above centerline)
      }
      
      // Now redistribute these angles using a deterministic function to
      // concentrate particles toward the right side (0 degrees)
      for (let i = 0; i < baseAngles.length; i++) {
        const angle = baseAngles[i];
        
        // Since we're already generating angles in the -π to +π range with
        // perfect symmetry around 0, we only need to apply the compression
        
        // The compression should be symmetric around 0 and preserve the sign
        // Using a quadratic function for smoother compression
        const absAngle = Math.abs(angle);
        // Use a more gentle, smooth compression based on quadratic curve
        // This creates a more natural funnel shape than the sharp sin(θ/2)
        const compressionFactor = (absAngle / Math.PI) * (absAngle / Math.PI);
        
        // Apply a gentler 50% maximum compression for smoother distribution
        // This creates more particles at intermediate angles for a funnel shape
        // rather than the sharp V-shape from the previous 75% compression
        const transformedAngle = angle * (1 - 0.5 * compressionFactor);
        
        // Convert from our -π to +π space back to 0 to 2π space that the rendering uses
        const normalizedAngle = (transformedAngle + 2 * Math.PI) % (2 * Math.PI);
        
        particleAngles.push(normalizedAngle);
      }
      
      // Sort is not strictly needed since our generation is already in order,
      // but keep it for safety
      particleAngles.sort((a, b) => a - b);
      
      // Create particles at the calculated angles
      for (const angle of particleAngles) {
        const particleX = x + Math.cos(angle) * fixedRadius;
        const particleY = y + Math.sin(angle) * fixedRadius;

        // Increase particle size to prevent squeezing through walls but keep perfect elasticity
        const body = Matter.Bodies.circle(particleX, particleY, 0.5, { // Increased from 0.1 to 0.5
          friction: 0.0,     // No friction to match walls and prevent energy loss 
          restitution: 1.0,  // Perfect elasticity (no energy loss)
          mass: 0.2,         // Increased mass to make particles less likely to squeeze through
          frictionAir: 0,    // No air resistance
          density: 0.8,      // Slightly reduced density for more dynamic bounces
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,
            group: -1
          }
        });

        // Reduce base speed by an additional 30% as requested
        const baseSpeed = 0.67 * 1.3 * 1.5 * 1.2 * 1.5 * 2 * 0.7 * 0.7; // Additional 30% reduction
        
        // Calculate how much the particle is aligned with the horizontal axis
        // cos(angle) is 1 or -1 at 0° and 180° (horizontal alignment)
        // and 0 at 90° and 270° (vertical alignment)
        const horizontalAlignment = Math.abs(Math.cos(angle));
        
        // Boost speed for horizontally-aligned particles but by less
        // 1 + 0.3 * horizontalAlignment gives boost from 1.0x to 1.3x based on alignment
        // Reduced from 0.5 to 0.3 to slow down the particles a bit more
        const directedSpeed = baseSpeed * (1 + 0.3 * horizontalAlignment);
        
        // Set velocity - still using the original angle, but with adjusted speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * directedSpeed,
          y: Math.sin(angle) * directedSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        // Create a properly typed particle
        const particle: Particle = {
          body,
          intensity: intensity,
          age: 0,
          groupId: groupId,  // Assign the same group ID to all particles in this ring
          isOriginal: true   // Mark as an original particle from the activation line
        };
        particles.push(particle);
        }

      // We want particles to decay within 6 cycles (doubled from 3)
      // One cycle is 6667 * 0.44 = 2933.48 ms
      // For 6 cycles: 6 * 2933.48 = 17600.88 ms
      // Using a base value that ensures particles live longer but still eventually decay
      const cycleTime = 6667 * 0.44;
      const maxCycles = 6; // Doubled from 3 to 6
      const baseMaxAge = cycleTime * maxCycles / 16.67; // Convert ms to frames (assuming 60fps)
      
      // Scale maxAge based on power, with twice the duration
      // Use a diminishing returns formula for power scaling to prevent excessive lifetimes
      const powerScaleFactor = 0.5 + (0.5 * Math.sqrt(particlePowerFactor / 3));
      const maxAge = baseMaxAge * powerScaleFactor;

      bubbles.push({
        x,
        y,
        radius: fixedRadius,
        initialRadius: fixedRadius,
        age: 0,
        maxAge,
        intensity: intensity,
        particles,
        groupId: groupId,  // Assign the same group ID to the bubble
        isOriginalSet: true  // Mark this as an original set created at the activation line
      });
    });

    return bubbles;
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

  updateParams(params: AnimationParams) {
    this.params = params;
    this.updateSpawnInterval();
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

  private drawFrame(progress: number) {
    // Calculate global opacity factor based on cycle progress
    // This will be used for all Bezier curves to ensure they all fade together
    const globalOpacityFactor = 1 - progress;
    if (this.funnelEnabled) {
      // Increased number of substeps for higher accuracy physics (especially for collisions)
      const numSubSteps = 6; // Increased from 3 to 6 for more accurate simulation
      const subStepTime = (1000 / 60) / numSubSteps; // Smaller time step for better collision handling
      for (let i = 0; i < numSubSteps; i++) {
        Matter.Engine.update(this.engine, subStepTime);
      }
    }

    const { width, height } = this.canvas;
    
    // Apply RTL transformation if enabled
    this.ctx.save();
    if (this.isRTL) {
      // Flip the canvas horizontally for RTL mode
      this.ctx.scale(-1, 1);
      this.ctx.translate(-width, 0);
    }
    
    // Reduce motion blur effect to make particles stay visible longer
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.06)'; // Reduced from 0.12 to 0.06 (50% reduction)
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
    
    // No more regular time-based spawning for white particles
    // We're now only spawning particles at the activation line
    
    // Update previous position for next frame
    this.previousSweepLineX = timeX;

    // Update and draw bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      // Check if bubble is close to activation line
      const isInActiveWindow = Math.abs(bubble.x - this.activationLineX) < 5;

      // Enable collisions for all particles with walls
      if (bubble.particles.length > 0) {
        bubble.particles.forEach(particle => {
          const collisionFilter = {
            category: 0x0001,
            mask: 0x0002, // All particles collide with walls
            group: -1 // All particles can collide
          };
          Matter.Body.set(particle.body, 'collisionFilter', collisionFilter);
        });
      }

      // Remove bubbles without any particles
      if (bubble.particles.length === 0) {
        return false;
      }

      if (bubble.age >= bubble.maxAge) {
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
    const elapsed = performance.now() - this.startTime;
    // Double line speed by halving cycle time
    const cyclePeriod = 6667 * 0.44; // Slowed down by 10% (0.4 * 1.1)
    const currentCycleTime = Math.floor(elapsed / cyclePeriod);
    
    // Check if we've started a new cycle
    if (currentCycleTime > this.lastCycleTime) {
      this.lastCycleTime = currentCycleTime;
      // Call the cycle start callback if it exists
      if (this.onCycleStart) {
        this.onCycleStart();
      }
    }
    
    const progress = (elapsed % cyclePeriod) / cyclePeriod;
    this.drawFrame(progress);
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }
  
  private drawFunnelWalls() {
    if (this.funnelWalls.length !== 2) return;
    
    const [topWall, bottomWall] = this.funnelWalls;
    
    // Draw wall shapes based on the actual physics bodies
    const useCurvedWalls = this.wallCurvature > 0;
    
    // Get wall positions and vertices from the actual physics bodies
    if (useCurvedWalls) {
      // Draw curved walls using the vertices from Matter.js bodies
      if (topWall.vertices && topWall.vertices.length > 0) {
        // Draw top wall
        this.ctx.beginPath();
        this.ctx.moveTo(topWall.vertices[0].x, topWall.vertices[0].y);
        for (let i = 1; i < topWall.vertices.length; i++) {
          this.ctx.lineTo(topWall.vertices[i].x, topWall.vertices[i].y);
        }
        this.ctx.closePath();
        
        // Smoky white fill
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.fill();
        
        // White border
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
      }
      
      if (bottomWall.vertices && bottomWall.vertices.length > 0) {
        // Draw bottom wall
        this.ctx.beginPath();
        this.ctx.moveTo(bottomWall.vertices[0].x, bottomWall.vertices[0].y);
        for (let i = 1; i < bottomWall.vertices.length; i++) {
          this.ctx.lineTo(bottomWall.vertices[i].x, bottomWall.vertices[i].y);
        }
        this.ctx.closePath();
        
        // Smoky white fill
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.fill();
        
        // White border
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
      }
    } else {
      // Draw rectangular walls for straight walls
      const wallThickness = 12; // Match the thickness from setupFunnelWalls
      
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
  }
}