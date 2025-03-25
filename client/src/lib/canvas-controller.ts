import Matter from 'matter-js';

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

interface WallSpring {
  body: Matter.Body;
  equilibriumX: number;
  velocity: number;
  displacement: number;
  lastUpdateTime: number;
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
  private wallSprings: WallSpring[] = [];
  private previousSweepLineX: number = 0; // Track previous position of sweep line
  private activationLineX: number = 0; // Will be set to 20% of canvas width
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000; // Default spawn interval in ms
  private wallCurvature: number = 0; // 0 = straight wall, 1 = max curve
  private gapSize: number = 0.4; // Normalized gap size (fraction of canvas height)
  private topWallAngle: number = 0; // Store angle for top wall in radians
  private bottomWallAngle: number = 0; // Store angle for bottom wall in radians
  private currentGroupId: number = 0; // Counter for generating unique group IDs

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    // Configure engine with better iteration parameters
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 6,  // Increased from default 6
      velocityIterations: 8,  // Increased from default 4
      constraintIterations: 4 // Added explicit constraint iterations
    });

    this.params = {
      power: 3, // Default power level (mid-range: 1-7)
      frequency: 0.15  // Default frequency from home.tsx
    };
    
    // Set the activation line at 20% of canvas width
    this.activationLineX = canvas.width * 0.2;
    
    // Calculate initial spawn interval based on frequency
    this.updateSpawnInterval();

    this.canvas.style.backgroundColor = '#1a1a1a';
    this.setupFunnelWalls();
    
    // Set up collision detection to trigger spring vibrations
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        // Check if one of the collision bodies is a wall
        const wallIndex = this.funnelWalls.findIndex(wall => 
          wall.id === pair.bodyA.id || wall.id === pair.bodyB.id
        );
        
        if (wallIndex !== -1) {
          // Get the other body (the particle)
          const particle = pair.bodyA.id === this.funnelWalls[wallIndex].id ? pair.bodyB : pair.bodyA;
          // Calculate impact force based on relative velocity
          const relVelocity = {
            x: particle.velocity.x - this.funnelWalls[wallIndex].velocity.x,
            y: particle.velocity.y - this.funnelWalls[wallIndex].velocity.y
          };
          
          // Get the wall spring
          const wallSpring = this.wallSprings[wallIndex];
          if (wallSpring) {
            // Apply impulse to wall spring based on x-component of relative velocity
            // Scale down the impulse since we're dealing with many small particles
            const impulse = relVelocity.x * 0.1;
            wallSpring.velocity += impulse;
          }
        }
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
    this.wallSprings = []; // Clear wall springs

    if (!this.funnelEnabled) return;

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    const centerY = height * 0.5;
    const gapSize = height * this.gapSize; // Use the stored gap size
    const wallThickness = 12; // Reduced from 20 to make walls more slender
    const wallLength = height // Increased to 0.85 for complete closure

    // Set up walls as static bodies with perfect restitution
    const wallOptions = {
      isStatic: true,
      restitution: 1.0, // Perfect elasticity (no energy loss)
      friction: 0.3, // Reduced friction by 50%
      frictionStatic: 0.45, // Reduced static friction by 50%
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
    
    // Create spring data for visual effects only
    const currentTime = performance.now();
    this.wallSprings = [
      {
        body: topWall,
        equilibriumX: midX,
        velocity: 0,
        displacement: 0,
        lastUpdateTime: currentTime
      },
      {
        body: bottomWall,
        equilibriumX: midX,
        velocity: 0,
        displacement: 0,
        lastUpdateTime: currentTime
      }
    ];
  }

  private generateBubbles(x: number): Bubble[] {
    const { power } = this.params;
    const centerY = this.canvas.height / 2;
    const height = this.canvas.height;
    const width = this.canvas.width;

    // Always generate the maximum number of waves
    const numWaves = 8; 
    
    const bubbles: Bubble[] = [];
    const fixedRadius = 7.2;

    // Generate evenly spaced positions but closer to the centerline
    const positions: number[] = [];
    const spacing = height / (numWaves + 1);
    const compressionFactor = 0.65; // Increased compression to bring rings much closer to center
    
    for (let i = 1; i <= numWaves; i++) {
      // Calculate position with compression toward center
      const normalPosition = i / (numWaves + 1); // 0.1 to 0.9
      const compressedPosition = centerY + (normalPosition - 0.5) * height * compressionFactor;
      positions.push(compressedPosition);
    }

    // Always use the activation line position for spawning particles
    // This ensures particles only appear at the activation line
    x = this.activationLineX;
    
    // All particles are active since we're only generating at the activation line
    const isActive = true;
    
    positions.forEach(y => {
      // Always create active blue particles
      const intensity = 1.0;

      // Generate a unique group ID for this ring of particles
      const groupId = this.currentGroupId++;
      
      const particles: Particle[] = [];
      // Create particles for blue waves
      // Set fixed number of particles to 20
      const numParticlesInRing = 20;
        for (let i = 0; i < numParticlesInRing; i++) {
          const angle = (i / numParticlesInRing) * Math.PI * 2;
          const particleX = x + Math.cos(angle) * fixedRadius;
          const particleY = y + Math.sin(angle) * fixedRadius;

          const body = Matter.Bodies.circle(particleX, particleY, 0.1, {
            friction: 0.1, // Reduced friction by 50%
            restitution: 1.0, // Perfect elasticity
            mass: 0.1,
            frictionAir: 0,
            collisionFilter: {
              category: 0x0001,
              mask: 0x0002,
              group: -1
            }
          });

          // Doubled the previous speed
          const speed = 0.67 * 1.3 * 1.5 * 1.2 * 1.5 * 2;
          Matter.Body.setVelocity(body, {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
          });

          Matter.Composite.add(this.engine.world, body);
          particles.push({
            body,
            intensity: intensity,
            age: 0,
            groupId: groupId  // Assign the same group ID to all particles in this ring
          });
        }

      const baseMaxAge = 80;
      // Apply power factor to the max age (from 1/3 to 7/3 of base value at power=3)
      const powerFactor = power / 3;
      // All particles are now active blue ones, so always use the longer maxAge
      const maxAge = baseMaxAge * 6 * 1.5 * 4 * powerFactor;

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
    // Update wall springs before physics engine
    if (this.funnelEnabled) {
      // Spring physics parameters
      const springConstant = 0.25; // Spring stiffness
      const dampingFactor = 0.05; // Low damping for oscillation

      // Maximum particle size to set max vibration amplitude
      const maxAmplitude = 2.0; // About the size of a particle

      // Update spring physics for walls
      const currentTime = performance.now();
      this.wallSprings.forEach(spring => {
        const deltaTime = (currentTime - spring.lastUpdateTime) / 1000; // Convert to seconds
        if (deltaTime > 0) {
          // Calculate spring force: F = -kx (where k is spring constant, x is displacement)
          const springForce = -springConstant * spring.displacement;
          // Calculate damping force: F = -cv (where c is damping factor, v is velocity)
          const dampingForce = -dampingFactor * spring.velocity;
          // Total force
          const totalForce = springForce + dampingForce;
          
          // Update velocity: v = v + a*t (where a = F/m)
          // For simplicity, assuming mass of 1 for calculations
          spring.velocity += totalForce * deltaTime;
          
          // Update displacement: x = x + v*t
          spring.displacement += spring.velocity * deltaTime;
          
          // Constrain displacement to maximum amplitude
          if (Math.abs(spring.displacement) > maxAmplitude) {
            spring.displacement = Math.sign(spring.displacement) * maxAmplitude;
            // Reduce velocity when hitting amplitude limits
            spring.velocity *= 0.8;
          }
          
          // Update the wall position
          Matter.Body.setPosition(spring.body, {
            x: spring.equilibriumX + spring.displacement,
            y: spring.body.position.y
          });
          
          spring.lastUpdateTime = currentTime;
        }
      });

      // Regular physics update
      const numSubSteps = 5;
      const subStepTime = (1000 / 60) / numSubSteps;
      for (let i = 0; i < numSubSteps; i++) {
        Matter.Engine.update(this.engine, subStepTime);
      }
    }

    const { width, height } = this.canvas;
    // Reduce motion blur by increasing alpha by 20%
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.09)'; // Increased from 0.075 by 20%
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

      // Update collision filters based on active state
      if (bubble.particles.length > 0) {
        bubble.particles.forEach(particle => {
          const collisionFilter = {
            category: 0x0001,
            mask: isInActiveWindow ? 0x0002 : 0x0000, // Only active particles collide with walls
            group: isInActiveWindow ? -1 : 1 // Inactive particles don't collide with anything
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
        
        // Draw smooth bezier curves between particles for blue waves only
        if (isInActiveWindow && bubble.particles.length > 1) {
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
            // Draw a glow effect for the curve first
            this.ctx.beginPath();
            const lineOpacity = opacity * 0.6; // Slightly increased opacity for better visibility
            // Scale shadow effect by power factor
            const powerFactor = this.params.power / 3;
            this.ctx.shadowColor = 'rgba(0, 220, 255, 0.3)';
            this.ctx.shadowBlur = 8 * powerFactor;
            this.ctx.strokeStyle = `rgba(20, 210, 255, ${lineOpacity})`;
            this.ctx.lineWidth = 1.8 * powerFactor;
            
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
            
            // Reset shadow effects after drawing the curve
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
            
            // Draw particles as semi-transparent circles to emphasize the curve
            visibleParticles.forEach(particle => {
              const pos = particle.body.position;
              // Calculate particle size with growth factor
              const particleSize = 1.5 * 1.2 * 1.2 * (1 + (particle.age / bubble.maxAge) * 0.4);
              // Draw a filled circle with a subtle glow effect
              this.ctx.beginPath();
              this.ctx.arc(pos.x, pos.y, particleSize * 0.7, 0, Math.PI * 2);
              this.ctx.fillStyle = `rgba(0, 200, 255, ${lineOpacity * 0.3})`;
              this.ctx.fill();
              
              // Add a tiny bright center to each particle
              this.ctx.beginPath();
              this.ctx.arc(pos.x, pos.y, particleSize * 0.2, 0, Math.PI * 2);
              this.ctx.fillStyle = `rgba(120, 220, 255, ${lineOpacity * 0.6})`;
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
    
    // No wall highlighting effect during collisions
    // Only maintain the wall spring data for position effects
  }
}