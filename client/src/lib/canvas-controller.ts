import Matter from 'matter-js';

interface AnimationParams {
  coherence: number;
  startTime: number;
  endTime: number;
  frequency: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  age: number;
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
  private funnelEnabled: boolean = false;
  private engine: Matter.Engine;
  private funnelWalls: Matter.Body[] = [];
  private wallSprings: WallSpring[] = [];
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000; // Default spawn interval in ms
  private wallCurvature: number = 0; // 0 = straight wall, 1 = max curve
  private gapSize: number = 0.4; // Normalized gap size (fraction of canvas height)
  private topWallAngle: number = 0; // Store angle for top wall in radians
  private bottomWallAngle: number = 0; // Store angle for bottom wall in radians

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
      coherence: 2.5,
      startTime: 0,
      endTime: 100,
      frequency: 0.15  // Default frequency from home.tsx
    };
    
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
    const wallLength = height * 0.7; // Increased from 0.4 to 0.7 for longer walls

    // Set up walls as static bodies with perfect restitution
    const wallOptions = {
      isStatic: true,
      restitution: 1.0, // Perfect elasticity (no energy loss)
      friction: 0.05, // Lower friction
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
    const { coherence } = this.params;
    const centerY = this.canvas.height / 2;
    const height = this.canvas.height;

    const minWaves = 4;
    const maxWaves = 8; // Increased from 5 to 6
    const numWaves = Math.floor(minWaves + (coherence / 5) * (maxWaves - minWaves));

    const bubbles: Bubble[] = [];
    const fixedRadius = 7.2;

    const positions: number[] = [];
    if (coherence === 5) {
      const spacing = height / (numWaves + 1);
      for (let i = 1; i <= numWaves; i++) {
        positions.push(spacing * i);
      }
    } else {
      const margin = height * 0.1;
      for (let i = 0; i < numWaves; i++) {
        positions.push(margin + Math.random() * (height - 2 * margin));
      }
      positions.sort((a, b) => a - b);
    }

    positions.forEach(y => {
      const normalizedX = x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
        normalizedX <= this.params.endTime;
      const intensity = isInActiveWindow ? 1.0 : 0.3;

      const particles: Particle[] = [];
      if (this.funnelEnabled) {
        // Reduced by another 20% from previous value ((48 * 1.3) * 0.8)
        const numParticlesInRing = Math.floor((48 * 1.3) * 0.8 * 0.8);
        for (let i = 0; i < numParticlesInRing; i++) {
          const angle = (i / numParticlesInRing) * Math.PI * 2;
          const particleX = x + Math.cos(angle) * fixedRadius;
          const particleY = y + Math.sin(angle) * fixedRadius;

          const body = Matter.Bodies.circle(particleX, particleY, 0.1, {
            friction: 0,
            restitution: 1.0, // Perfect elasticity
            mass: 0.1,
            frictionAir: 0,
            collisionFilter: {
              category: 0x0001,
              mask: 0x0002,
              group: -1
            }
          });

          // Increased speed by 50% from previous value
          const speed = 0.67 * 1.3 * 1.5 * 1.2 * 1.5;
          Matter.Body.setVelocity(body, {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
          });

          Matter.Composite.add(this.engine.world, body);
          particles.push({
            body,
            intensity,
            age: 0
          });
        }
      }

      const baseMaxAge = 80;
      // Increase max age of blue particles by 50% again (total 2.25x from original)
      const maxAge = isInActiveWindow ? baseMaxAge * 6 * 1.5 * 4 : baseMaxAge * 0.5;

      bubbles.push({
        x,
        y,
        radius: fixedRadius,
        initialRadius: fixedRadius,
        age: 0,
        maxAge,
        intensity,
        particles
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

    // Draw time indicator line
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Timer-based spawning for regular rhythm
    const currentTime = performance.now();
    if (currentTime - this.lastSpawnTime >= this.spawnInterval) {
      const newBubbles = this.generateBubbles(timeX);
      this.bubbles.push(...newBubbles);
      this.lastSpawnTime = currentTime;
    }

    // Update and draw bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      const normalizedX = bubble.x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
        normalizedX <= this.params.endTime;

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
        this.ctx.beginPath();
        bubble.particles.forEach(particle => {
          const pos = particle.body.position;
          this.ctx.moveTo(pos.x, pos.y);
          // Increase particle sizes by 5x
          // Make active particles 20% larger (and growing with age)
          // For inactive particles, keep them smaller
          const growthFactor = isInActiveWindow ? 1 + (particle.age / bubble.maxAge) * 0.4 : 1;
          // Increased size by 20% for all particles
          const particleSize = isInActiveWindow ? 1.5 * 1.2 * 1.2 * growthFactor : 0.75 * 0.7 * 1.2;
          this.ctx.arc(pos.x, pos.y, particleSize, 0, Math.PI * 2);
        });

        const opacity = (1 - (bubble.age / bubble.maxAge)) * 0.7;
        if (isInActiveWindow) {
          this.ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
          this.ctx.lineWidth = 0.5;
        } else {
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
          this.ctx.lineWidth = 0.5;
        }

        this.ctx.stroke();
      } else {
        const opacity = 1 - (bubble.age / bubble.maxAge);
        this.ctx.beginPath();
        this.ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);

        if (isInActiveWindow) {
          this.ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
        } else {
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
        }
        this.ctx.lineWidth = 0.5;
        this.ctx.stroke();
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
  }

  private animate() {
    if (!this.startTime) return;
    const elapsed = performance.now() - this.startTime;
    // Increase line speed by 20% by reducing cycle time
    const cyclePeriod = 6667 * 0.8; // 20% faster (0.8 of original time)
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