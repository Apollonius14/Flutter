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
  private wallCurvature: number = 0; // 0 = straight wall, 1 = max curve
  private gapSize: number = 0.4; // Normalized gap size (fraction of canvas height)
  private topWallAngle: number = 0; // Store angle for top wall in radians
  private bottomWallAngle: number = 0; // Store angle for bottom wall in radians
  private currentGroupId: number = 0; // Counter for generating unique group IDs
  private positions: number[] = []; // Store wave positions

  constructor(canvas: HTMLCanvasElement) {
    console.time('Canvas initialization');
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false }); // Disable alpha for better performance
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    // Configure engine with minimal iteration parameters for faster loading
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 2,  // Reduced by half for much faster startup
      velocityIterations: 2,  // Reduced by half for much faster startup
      constraintIterations: 1  // Minimum value for fastest startup
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
    // Simple collision detection without spring effects
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // We keep the collision listener for potential future audio effects
      // But removed all spring-related code
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

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    
    // Wall dimensions - each wall is half the height of the canvas
    const wallThickness = 20;
    const wallLength = height * 0.5; // Each wall is half the canvas height
    
    // Calculate positions based on gap size
    // When gapSize = 0, walls are at 1/4 and 3/4 of canvas height
    // As gapSize increases, they move further apart
    
    // Normalized gap factor (0 to 1)
    const gapFactor = this.gapSize;
    
    // Base positions at 1/4 and 3/4 of canvas height
    const baseTopY = height * 0.25;
    const baseBottomY = height * 0.75;
    
    // Move walls apart based on gap factor
    // Maximum movement is 20% of canvas height in each direction
    const maxOffset = height * 0.2; 
    const topWallY = baseTopY - (gapFactor * maxOffset);
    const bottomWallY = baseBottomY + (gapFactor * maxOffset);

    // Set up walls as static bodies with perfect restitution
    const wallOptions = {
      isStatic: true,
      restitution: 1.0, // Perfect elasticity (no energy loss)
      friction: 0.2,
      frictionStatic: 0.2,
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001
      }
    };

    // Calculate wall angles - this is key for the angle-based rotation
    const wallAngleRadians = (this.wallCurvature * 90) * (Math.PI / 180);
    this.topWallAngle = -wallAngleRadians;
    this.bottomWallAngle = wallAngleRadians;

    // Create the walls with the calculated positions
    const topWall = Matter.Bodies.rectangle(
      midX,
      topWallY,
      wallThickness,
      wallLength,
      wallOptions
    );
    
    const bottomWall = Matter.Bodies.rectangle(
      midX,
      bottomWallY,
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

    // Generate more spread out positions along the blue line
    this.positions = []; // Clear previous positions
    const spreadFactor = 0.85; // Increased from 0.585 to spread waves more evenly
    
    // Calculate center and offsets for symmetric distribution
    const center = height / 2;
    const baseSpacing = (height * spreadFactor) / 8; // Divide space into 8 parts for 7 waves
    
    // Add positions in order from top to bottom, more spread out
    this.positions.push(center - baseSpacing * 3.5); // Outer top (moved further)
    this.positions.push(center - baseSpacing * 2.3); // Middle top (moved further)
    this.positions.push(center - baseSpacing * 1.1); // Inner top (moved further)
    //this.positions.push(center);                     // Center (unchanged)
    this.positions.push(center + baseSpacing * 1.1); // Inner bottom (moved further)
    this.positions.push(center + baseSpacing * 2.3); // Middle bottom (moved further)
    this.positions.push(center + baseSpacing * 3.5); // Outer bottom (moved further)

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
      // Increased by 10% from 17 to 19 particles per ring as requested
      const numParticlesInRing = 19;
      
      // Keep track of power factor for maxAge calculation
      const particlePowerFactor = this.params.power / 3;
      
      // Create an array to store the angles we'll use for particle placement
      const particleAngles: number[] = [];
      
      // Generate non-uniform angles to concentrate particles along horizontal axis
      for (let i = 0; i < numParticlesInRing; i++) {
        // Step 1: Generate a uniform angle distribution
        const uniformAngle = (i / numParticlesInRing) * Math.PI * 2;
        
        // Step 2: Apply a cosine-based transform to concentrate particles horizontally
        // Maximum concentration at 0° and 180° (left and right of circle)
        // We need to shift the particles toward 0° and 180° (horizontal axis)
        // Math.cos(uniformAngle) is 1 at 0°, -1 at 180°, and 0 at 90° and 270°
        
        // We want to keep the same ordering of particles but shift them toward horizontal axis
        // Using cos^2 function for smooth transition and always positive adjustment
        const concentrationStrength = 0.7; // Increased from 0.5 to 0.7 for stronger horizontal concentration
        
        // This makes angles at 0° and 180° move less (stay where they are),
        // while angles at 90° and 270° get pushed toward 0° and 180° respectively
        let distortedAngle: number;
        
        // For the top half of the circle (0 to π)
        if (uniformAngle < Math.PI) {
          // If in first quadrant (0 to π/2), pull toward 0
          if (uniformAngle < Math.PI/2) {
            distortedAngle = uniformAngle * (1 - concentrationStrength * Math.pow(Math.cos(uniformAngle), 2));
          } 
          // If in second quadrant (π/2 to π), pull toward π
          else {
            distortedAngle = uniformAngle + (Math.PI - uniformAngle) * concentrationStrength * Math.pow(Math.cos(uniformAngle), 2);
          }
        } 
        // For the bottom half of the circle (π to 2π)
        else {
          // If in third quadrant (π to 3π/2), pull toward π
          if (uniformAngle < 3 * Math.PI/2) {
            distortedAngle = uniformAngle - (uniformAngle - Math.PI) * concentrationStrength * Math.pow(Math.cos(uniformAngle), 2);
          } 
          // If in fourth quadrant (3π/2 to 2π), pull toward 2π
          else {
            distortedAngle = uniformAngle + (2 * Math.PI - uniformAngle) * concentrationStrength * Math.pow(Math.cos(uniformAngle), 2);
          }
        }
        
        particleAngles.push(distortedAngle);
      }
      
      // Sort the angles to maintain sequential ordering around the circle
      particleAngles.sort((a, b) => a - b);
      
      // Create particles at the calculated angles
      for (const angle of particleAngles) {
        const particleX = x + Math.cos(angle) * fixedRadius;
        const particleY = y + Math.sin(angle) * fixedRadius;

        const body = Matter.Bodies.circle(particleX, particleY, 0.1, {
          friction: 0.1, 
          restitution: 1.0, // Perfect elasticity
          mass: 0.1,
          frictionAir: 0,
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,
            group: -1
          }
        });

        // Reduce base speed by 30% as requested
        const baseSpeed = 0.67 * 1.3 * 1.5 * 1.2 * 1.5 * 2 * 0.7; // 30% reduction
        
        // Calculate how much the particle is aligned with the horizontal axis
        // cos(angle) is 1 or -1 at 0° and 180° (horizontal alignment)
        // and 0 at 90° and 270° (vertical alignment)
        const horizontalAlignment = Math.abs(Math.cos(angle));
        
        // Boost speed for horizontally-aligned particles
        // Reduced from 0.7 to 0.2 as requested by user
        // 1 + 0.2 * horizontalAlignment gives boost from 1.0x to 1.2x for horizontal particles
        const directedSpeed = baseSpeed * (1 + 0.2 * horizontalAlignment);
        
        // Set velocity - still using the original angle, but with adjusted speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * directedSpeed,
          y: Math.sin(angle) * directedSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        particles.push({
          body,
          intensity: intensity,
          age: 0,
          groupId: groupId  // Assign the same group ID to all particles in this ring
        });
        }

      // Increase the base max age to make particles persist twice as long
      const baseMaxAge = 320 * 2; // Doubled to 640 as requested
      // All particles are now active blue ones, so always use the longer maxAge
      // Use the power factor for max age (keeping the same modifiers)
      const maxAge = baseMaxAge * 6 * 1.5 * 4 * particlePowerFactor;

      bubbles.push({
        x,
        y,
        radius: fixedRadius,
        initialRadius: fixedRadius,
        age: 0,
        maxAge,
        intensity: intensity,
        particles,
        groupId: groupId  // Assign the same group ID to the bubble
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
    if (this.funnelEnabled) {
      // Regular physics update with reduced substeps for better performance
      const numSubSteps = 3; // Reduced from 5 for better performance
      const subStepTime = (1000 / 60) / numSubSteps;
      for (let i = 0; i < numSubSteps; i++) {
        Matter.Engine.update(this.engine, subStepTime);
      }
    }

    const { width, height } = this.canvas;
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

      if (this.funnelEnabled && bubble.particles.length > 0) {
        const opacity = (1 - (bubble.age / bubble.maxAge)) * 0.7;
        
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
              return pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height;
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
            for (let blur = 3; blur >= 0; blur--) {
              this.ctx.beginPath();
              const currentOpacity = (opacity * 0.6) * (1 - blur * 0.2); // Fade out each blur layer
              
              // Only use shadow effect for higher power levels to save rendering time
              if (this.params.power > 3) {
                this.ctx.shadowColor = 'rgba(0, 220, 255, 0.3)';
                this.ctx.shadowBlur = 5 * drawPowerFactor; // Reduced from 8 to 5
              } else {
                this.ctx.shadowColor = 'transparent';
                this.ctx.shadowBlur = 0;
              }
              this.ctx.strokeStyle = `rgba(20, 210, 255, ${currentOpacity})`;
              
              // Calculate line thickness based on wave position
              let thicknessFactor = 1.0;
              const waveIndex = Math.floor(this.positions.indexOf(bubble.y));
              const middleIndex = 3; // Center wave index
              const distanceFromMiddle = Math.abs(waveIndex - middleIndex);
              
              if (distanceFromMiddle === 0) thicknessFactor = 1.2; // Center: 20% thicker
              else if (distanceFromMiddle === 1) thicknessFactor = 1.1; // Inner: 10% thicker
              else if (distanceFromMiddle === 2) thicknessFactor = 1.05; // Middle: 5% thicker
              // Outer waves use default thickness (1.0)
              
              this.ctx.lineWidth = 1.8 * drawPowerFactor * thicknessFactor;
              
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
            
            // Create a local opacity value for particles
            const particleOpacity = opacity * 0.6;
            
            // Draw particles as bright neon pink circles to clearly see their positions
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
            
            // Also draw the particle dots in neon pink for consistency
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
  }

  private animate() {
    if (!this.startTime) return;
    const elapsed = performance.now() - this.startTime;
    // Double line speed by halving cycle time
    const cyclePeriod = 6667 * 0.44; // Slowed down by 10% (0.4 * 1.1)
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