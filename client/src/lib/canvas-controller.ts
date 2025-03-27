import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  age: number;
  groupId: number; // Add group ID to identify particles in the same ring
  cycleNumber: number; // Which cycle this particle was created in
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
  groupId: number; // Add group ID to identify this bubble's particle group
  cycleNumber: number; // Which cycle this bubble was created in
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWidth: number; // Store canvas width as class variable
  private canvasHeight: number; // Store canvas height as class variable
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
  private currentCycleNumber: number = 0; // Current cycle number
  private positions: number[] = []; // Store wave positions
  private isRTL: boolean = false; // RTL mode toggle (right-to-left for Arabic)
  private showParticles: boolean = true; // Toggle to show/hide individual particles

  constructor(canvas: HTMLCanvasElement) {
    console.time('Canvas initialization');
    this.canvas = canvas;
    // Store canvas dimensions as class properties
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    
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
      frequency: 0.3  // Default frequency from home.tsx
    };
    
    // Set the activation line at 20% of canvas width
    this.activationLineX = canvas.width * 0.3;
    
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
    // With our new cycle-based approach, we don't need to track collision state changes
    // So this method now just sets up the collision detection without modifying particle properties
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // We can use this event for sound effects or other collision feedback if needed
      // But we don't need to modify particle properties here anymore
    });
  }
  
  // Helper method to update spawn interval based on frequency
  private updateSpawnInterval() {
    // Lower frequency value = less frequent spawning = higher interval
    // Base interval now increased by 1.5x, then 1.2x, then 1.5x, and now by another 1.2x
    const baseInterval = 4000 / (1.5 * 1.2 * 1.9 * 1.2); // Increased frequency by an additional 20%
    this.spawnInterval = baseInterval;
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
    
    const bubbles: Bubble[] = [];
    const fixedRadius = 7.2;

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
    // We're using 10 waves now with 4 above and 4 below the centerline (plus the offset)
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
    
    
    this.positions.forEach(y => {
      // Always create active blue particles
      const intensity = 2.0;

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
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,
            group: -1
          }
        });

        const baseSpeed = 2; 
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
          age: 0,
          groupId: groupId,  // Assign the same group ID to all particles in this ring
          cycleNumber: this.currentCycleNumber  // Assign current cycle number
        };
        particles.push(particle);
        }

      // We want particles to decay within 24 cycles (doubled from 12)
      // One cycle is 6667 * 0.44 = 2933.48 ms
      // For 24 cycles: 24 * 2933.48 = 70403.52 ms
      // Using a base value that ensures particles live longer but still eventually decay
      const cycleTime = 6667 * 0.44;
      const maxCycles = 24; // Doubled from 12 to 24
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
        cycleNumber: this.currentCycleNumber  // Assign current cycle number
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
    // Define width and height variables that can be used throughout this method
    const width = this.canvas.width;
    const height = this.canvas.height;
    // Calculate global opacity factor based on cycle progress
    // This will be used for all Bezier curves to ensure they all fade together
    const globalOpacityFactor = (1 - (0.05 * progress));
    if (this.funnelEnabled) {
      // Increased number of substeps for higher accuracy physics (especially for collisions)
      const numSubSteps = 6; // Increased from 3 to 6 for more accurate simulation
      const subStepTime = (1000 / 60) / numSubSteps; // Smaller time step for better collision handling
      for (let i = 0; i < numSubSteps; i++) {
        Matter.Engine.update(this.engine, subStepTime);
      }
    }
    
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
    
    // No more regular time-based spawning for white particles
    // We're now only spawning particles at the activation line
    
    // Update previous position for next frame
    this.previousSweepLineX = timeX;

    // Limit physics calculations to on-screen elements
    const bufferMargin = 50; // Extra margin around screen to prevent abrupt changes
    const screenBounds = {
      min: { x: -bufferMargin, y: -bufferMargin },
      max: { x: this.canvas.width + bufferMargin, y: this.canvas.height + bufferMargin }
    };
    
    // Update and draw bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;


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
        // Calculate opacity based on both cycle progress and age difference between current and bubble cycle
        // This ensures bubbles from older cycles fade out nicely
        
        // Age factor: newer cycles are more visible than older ones
        // For current cycle (cycleNumber === this.currentCycleNumber): factor = 1.0
        // For previous cycle (cycleNumber === this.currentCycleNumber - 1): factor = 0.5
        // For older cycles: factor = 0
        const cycleDiff = this.currentCycleNumber - bubble.cycleNumber;
        
        if (cycleDiff > 8) {
          // Particles more than 8 cycles old should not be rendered
          return true; // Skip rendering but keep for physics until properly cleaned up
        }
        
        // Calculate age-based opacity factor with more gradual degradation for longer display
        // Start with 1.0 for current cycle, with gradual reductions for older cycles
        let cycleAgeFactor = 1.0;
        if (cycleDiff > 0) {
          // Even more gradual reduction: 0.9, 0.8, 0.7, 0.6, etc. for cycles 1-8
          // This creates a slower opacity decay over time
          cycleAgeFactor = Math.max(0.1, 1.0 - (cycleDiff * 0.1));
        }
        
        // Combine with global opacity factor from current cycle progress
        // Reduce the fade rate by 50% by multiplying by 0.35 instead of 0.7
        let opacity = globalOpacityFactor * cycleAgeFactor * 0.7;
        
        // We no longer draw inactive particles - they're completely invisible
        // Only blue particles at the activation line are visible
        // For active particles, they'll be drawn with the bezier curves below
        // We skip drawing them here to avoid double-rendering
        
        // Draw all particles with bezier curves, not just those near the activation line
        if (bubble.particles.length > 1) {
          const visibleParticles = bubble.particles
            .filter(p => {
              // Get particles that are on screen
              const pos = p.body.position;
              return pos.x >= 0 && pos.x <= this.canvas.width && pos.y >= 0 && pos.y <= this.canvas.height;
            })
            .sort((a, b) => {
              // Sort particles by angle around the center
              const aPos = a.body.position;
              const bPos = b.body.position;
              const aAngle = Math.atan2(aPos.y - bubble.y, aPos.x - bubble.x);
              const bAngle = Math.atan2(bPos.y - bubble.y, bPos.x - bubble.x);
              return aAngle - bAngle;
            });
          
          if (visibleParticles.length > 2) {
            // Calculate power factor for drawing
            const drawPowerFactor = this.params.power / 3;
            
            // Draw a glow effect for the curve first
            // Add motion blur effect by drawing multiple semi-transparent layers
            // Added a fifth Bezier curve (blur level 4) for more fluid feel
            for (let blur = 6; blur >= 0; blur--) {
              this.ctx.beginPath();
              const currentOpacity = (opacity * 0.9) * (1 - blur * 0.2); // Fade out each blur layer
              
              // Only use shadow effect for higher power levels to save rendering time
              if (this.params.power > 3) {
                this.ctx.shadowColor = 'rgba(0, 220, 255, 0.3)';
                this.ctx.shadowBlur = 8 * drawPowerFactor; // Reduced from 8 to 5
              } else {
                this.ctx.shadowColor = 'transparent';
                this.ctx.shadowBlur = 0;
              }
              this.ctx.strokeStyle = `rgba(20, 210, 255, ${currentOpacity})`;
              
              // Calculate line thickness based on wave position
              let thicknessFactor = 1.0;
              const waveIndex = Math.floor(this.positions.indexOf(bubble.y));
              // With 9 positions (0-8), update the central, inner, and outer positions
              const centralPositions = [4, 5]; // The two positions closest to center
              const innerPositions = [3, 6];   // The next two positions from center
              const middlePositions = [2, 7];  // The middle positions
              const outerPositions = [1, 8];   // The outer positions
              const farthestPositions = [0, 9]; // The farthest positions
              
              // Assign thickness based on position group
              if (centralPositions.includes(waveIndex)) thicknessFactor = 1.8;      // Center: 20% thicker
              else if (innerPositions.includes(waveIndex)) thicknessFactor = 1.6;  // Inner: 15% thicker
              else if (middlePositions.includes(waveIndex)) thicknessFactor = 1.3;  // Middle: 10% thicker
              else if (outerPositions.includes(waveIndex)) thicknessFactor = 1.05;  // Outer: 5% thicker
              else if (farthestPositions.includes(waveIndex)) thicknessFactor = 1.0; // Farthest: default thickness
              
              // Scale line width using the global cycle progress and cycle age
              // This makes lines thinner as they age, instead of less opaque
              // Make lines 50% thicker at all power levels as requested
              // More gradual degradation of thickness over multiple cycles
              const cycleDiff = this.currentCycleNumber - bubble.cycleNumber;
              let cycleAgeFactor;
              
              if (cycleDiff === 0) {
                // Current cycle: decrease from 1.0 to 0.0 over cycle
                cycleAgeFactor = 1.0 - (0.5* progress);
              } else {
                // More gradual thickness reduction for older cycles
                // Start at 0.9 for previous cycle, reduce by 0.1 per cycle for a more gradual fade
                cycleAgeFactor = Math.max(0.1, 0.9 - ((cycleDiff - 1) * 0.1));
              }
              
              // Base width increased by 50% (from 1.8 to 2.7)
              this.ctx.lineWidth = 2.7 * drawPowerFactor * thicknessFactor * cycleAgeFactor;
              
              // Start at the first particle
              const startPos = visibleParticles[0].body.position;
              this.ctx.moveTo(startPos.x, startPos.y);
              
              // Use cubic bezier curves to create a smooth path through all particles
              for (let i = 0; i < visibleParticles.length - 1; i++) {
                const p0 = visibleParticles[Math.max(0, i-1)].body.position;
                const p1 = visibleParticles[i].body.position;
                const p2 = visibleParticles[i+1].body.position;
                const p3 = visibleParticles[Math.min(visibleParticles.length-1, i+2)].body.position;
                
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
            
            // Reset shadow effects after drawing the curve
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
            
            
            
            // Draw particles as bright neon pink circles only if showParticles is true
            if (this.showParticles) {
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                // Calculate particle size with growth factor
                const particleSize = 1.5 * 1.2 * 1.2 * (1 + (particle.age / bubble.maxAge) * 0.4);
                
                // Draw a filled circle with neon pink glow effect
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, particleSize * 0.8, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 50, 200, 0.6)'; // Neon pink
                this.ctx.fill();
                
                // Add a bright white center to each particle for emphasis
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, particleSize * 0.3, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                this.ctx.fill();
              });
            }
          } else if (visibleParticles.length > 1) {
            // If we don't have enough points for a proper curve, fall back to lines
            this.ctx.beginPath();
            const lineOpacity = opacity * 0.4;
            this.ctx.strokeStyle = `rgba(0, 200, 255, ${lineOpacity})`;
            this.ctx.lineWidth = 0.8;
            
            for (let i = 0; i < visibleParticles.length - 1; i++) {
              const pos1 = visibleParticles[i].body.position;
              const pos2 = visibleParticles[i + 1].body.position;
              this.ctx.moveTo(pos1.x, pos1.y);
              this.ctx.lineTo(pos2.x, pos2.y);
            }
            
            this.ctx.stroke();
            
            // Also draw the particle dots in neon pink for consistency if showParticles is true
            if (this.showParticles) {
              visibleParticles.forEach(particle => {
                const pos = particle.body.position;
                const particleSize = 1.5 * 1.2 * 1.2 * (1 + (particle.age / bubble.maxAge) * 0.4);
                
                // Draw a filled circle with neon pink glow effect
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, particleSize * 0.8, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 50, 200, 0.6)'; // Neon pink
                this.ctx.fill();
                
                // Add a bright white center
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, particleSize * 0.3, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                this.ctx.fill();
              });
            }
          }
        }
      } 
      // We no longer draw non-particle bubbles at all

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
      // Increment the cycle number
      this.currentCycleNumber++;
      console.log(`Starting cycle ${this.currentCycleNumber}`);
      
      // Remove bubbles and particles that are more than 8 cycles old (doubled from 4)
      this.bubbles = this.bubbles.filter(bubble => {
        // Keep bubble if its cycle number is within 8 cycles of current cycle
        return this.currentCycleNumber - bubble.cycleNumber <= 8;
      });
      
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
    
    // Update physics engine with a slightly shorter time step as requested
    // Using 12.5ms instead of 16.67ms (approximately 80fps instead of 60fps)
    Matter.Engine.update(this.engine, 12.5); // Shorter time step for more fluid simulation
    
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