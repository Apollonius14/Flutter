import Matter from 'matter-js';

interface AnimationParams {
  turbulence: number;
  coherence: number;
  startTime: number;
  endTime: number;
  peakPower: number;
  pulseIntensity: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  age: number;
  initialSpeed: number; // Added initialSpeed property
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

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];
  private funnelEnabled: boolean = false;

  // Matter.js components
  private engine: Matter.Engine;
  private funnelWalls: Matter.Body[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    // Initialize Matter.js engine
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 }
    });

    this.params = {
      turbulence: 2.5,
      coherence: 2.5,
      startTime: 0,
      endTime: 100,
      peakPower: 5,
      pulseIntensity: 0,
    };

    this.canvas.style.backgroundColor = '#1a1a1a';
    this.setupFunnelWalls();

    // Add collision handling to maintain proper reflection angles
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;

        // Only handle particle-wall collisions
        if (bodyA.collisionFilter.category === 0x0001 && bodyB.collisionFilter.category === 0x0002) {
          const particle = bodyA;
          const wall = bodyB;

          // Get the wall's normal vector
          const wallAngle = wall.angle;
          const normalX = Math.sin(wallAngle);
          const normalY = -Math.cos(wallAngle);

          // Calculate reflection vector
          const v = particle.velocity;
          const speed = Math.sqrt(v.x * v.x + v.y * v.y);

          // Dot product
          const dot = v.x * normalX + v.y * normalY;

          // Reflection formula: v' = v - 2(v·n)n
          const reflectedVx = v.x - 2 * dot * normalX;
          const reflectedVy = v.y - 2 * dot * normalY;

          // Normalize and apply original speed
          const mag = Math.sqrt(reflectedVx * reflectedVx + reflectedVy * reflectedVy);
          Matter.Body.setVelocity(particle, {
            x: (reflectedVx / mag) * speed,
            y: (reflectedVy / mag) * speed
          });
        }
      });
    });
  }

  private setupFunnelWalls() {
    // Remove existing walls
    this.funnelWalls.forEach(wall => Matter.World.remove(this.engine.world, wall));
    this.funnelWalls = [];

    if (!this.funnelEnabled) return;

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    const centerY = height * 0.5;
    const gapSize = height * 0.2; // 20% of height for the gap
    const wallHeight = 10;
    const wallLength = height * 0.4; // Length of each wall segment

    // Create wall segments
    const wallOptions = {
      isStatic: true,
      render: { visible: true },
      friction: 0, // Completely frictionless
      restitution: 1.0, // Perfect elasticity
      mass: 1000,
      density: 1,
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001
      }
    };

    // Top wall segment - vertical
    const topWall = Matter.Bodies.rectangle(
      midX,
      centerY - gapSize/2 - wallLength/2,
      wallHeight,
      wallLength,
      {
        ...wallOptions,
        angle: 0 // Vertical wall
      }
    );

    // Bottom wall segment - vertical
    const bottomWall = Matter.Bodies.rectangle(
      midX,
      centerY + gapSize/2 + wallLength/2,
      wallHeight,
      wallLength,
      {
        ...wallOptions,
        angle: 0 // Vertical wall
      }
    );

    this.funnelWalls = [topWall, bottomWall];
    this.funnelWalls.forEach(wall => Matter.World.add(this.engine.world, wall));
  }

  setFunnelEnabled(enabled: boolean) {
    this.funnelEnabled = enabled;
    this.setupFunnelWalls();
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
  }

  private sinc(x: number): number {
    if (x === 0) return 1;
    const scaledX = x * 2;
    const decay = Math.exp(-Math.abs(x));
    return (Math.sin(Math.PI * scaledX) / (Math.PI * scaledX)) * decay;
  }

  private generateBubble(x: number, currentTime: number): Bubble {
    const { coherence } = this.params;
    const centerY = this.canvas.height / 2;

    const normalizedX = x / this.canvas.width * 100;
    const midTime = (this.params.startTime + this.params.endTime) / 2;
    const timeWindow = this.params.endTime - this.params.startTime;
    const scaledTime = (normalizedX - midTime) / (timeWindow / 8);
    const sincValue = this.sinc(scaledTime);
    const intensity = (sincValue + 1) / 2;

    const baseRadius = 4 + coherence * 2;
    const radiusVariation = (5 - coherence) * 1.5;
    const radius = baseRadius + (Math.random() - 0.5) * radiusVariation;
    const yVariation = (5 - coherence) * 20;
    const y = centerY + (Math.random() - 0.5) * yVariation;

    const particles: Particle[] = [];
    const numParticles = 100; // Increased number of particles

    if (this.funnelEnabled) {
      // Create particles arranged in a circle
      for (let i = 0; i < numParticles; i++) {
        const angle = (i / numParticles) * Math.PI * 2;
        const particleX = x + Math.cos(angle) * radius;
        const particleY = y + Math.sin(angle) * radius;

        // Create particle body with smaller radius
        const body = Matter.Bodies.circle(particleX, particleY, 0.05, { // Reduced from 0.1 to 0.05
          friction: 0, // Completely frictionless
          restitution: 1.0, // Perfect elasticity
          mass: 0.01,
          density: 0.001, // Reduced density
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002
          },
          frictionAir: 0 // Disable air friction
        });

        // Add radial velocity with higher initial speed
        const speed = 2.5; // Increased base speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        });

        Matter.World.add(this.engine.world, body);

        particles.push({
          body,
          intensity,
          age: 0,
          initialSpeed: speed // Store initial speed
        });
      }
    }

    return {
      x,
      y,
      radius,
      initialRadius: radius,
      age: 0,
      maxAge: 80 + intensity * 40,
      intensity,
      particles
    };
  }

  private drawFunnel() {
    if (!this.funnelEnabled) return;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;

    // Draw walls as vertical lines
    this.funnelWalls.forEach(wall => {
      const vertices = wall.vertices;
      this.ctx.beginPath();
      this.ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        this.ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
    });
  }

  private updateAndDrawBubbles() {
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      const normalizedX = bubble.x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
        normalizedX <= this.params.endTime;

      if (this.funnelEnabled && bubble.particles.length > 0) {
        // Maintain particle velocities
        bubble.particles.forEach(particle => {
          const velocity = particle.body.velocity;
          const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
          if (currentSpeed !== 0) { // Avoid division by zero
            const scaleFactor = particle.initialSpeed / currentSpeed;
            Matter.Body.setVelocity(particle.body, {
              x: velocity.x * scaleFactor,
              y: velocity.y * scaleFactor
            });
          }
        });

        // Draw particles with matching visual size
        this.ctx.beginPath();
        bubble.particles.forEach(particle => {
          const pos = particle.body.position;
          this.ctx.moveTo(pos.x, pos.y);
          this.ctx.arc(pos.x, pos.y, 0.05, 0, Math.PI * 2); // Match the smaller physical size
        });

        if (isInActiveWindow) {
          // Active particles: full brightness, no decay
          this.ctx.shadowColor = 'rgba(0, 200, 255, 0.8)'; // Increased shadow opacity
          this.ctx.shadowBlur = 8; // Adjusted blur for smaller size
          this.ctx.strokeStyle = 'rgba(0, 200, 255, 1.0)';
          this.ctx.lineWidth = 0.3 + bubble.intensity * 12; // Adjusted line width for smaller particles
        } else {
          // Inactive particles: apply opacity decay
          const opacity = 1 - (bubble.age / bubble.maxAge);
          this.ctx.shadowBlur = 0;
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
          this.ctx.lineWidth = 0.25;
        }

        this.ctx.stroke();
      } else {
        // Regular bubble when funnel is disabled
        const opacity = 1 - (bubble.age / bubble.maxAge);
        this.ctx.beginPath();
        this.ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);

        if (isInActiveWindow) {
          this.ctx.shadowColor = 'rgba(0, 200, 255, 0.6)';
          this.ctx.shadowBlur = 10;
          this.ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
          this.ctx.lineWidth = 0.5 + bubble.intensity * 16;
        } else {
          this.ctx.shadowBlur = 0;
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
          this.ctx.lineWidth = 0.25;
        }

        this.ctx.stroke();
      }

      if (bubble.age >= bubble.maxAge) {
        // Clean up particles
        if (bubble.particles.length > 0) {
          bubble.particles.forEach(particle => {
            Matter.World.remove(this.engine.world, particle.body);
          });
        }
        return false;
      }
      return true;
    });
  }

  private drawFrame(progress: number) {
    if (this.funnelEnabled) {
      // Run physics updates at higher frequency for better collision detection
      for (let i = 0; i < 2; i++) { // Multiple updates per frame
        Matter.Engine.update(this.engine, (1000 / 60) / 2);
      }
    }

    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, width, height);

    const { startTime, endTime } = this.params;

    const timeX = width * progress;

    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    const midX = width * ((startTime + endTime) / 200);
    this.ctx.beginPath();
    this.ctx.moveTo(midX, 0);
    this.ctx.lineTo(midX, height);
    this.ctx.strokeStyle = "rgba(255, 50, 50, 0.05)";
    this.ctx.stroke();

    const currentTime = progress * 100;

    const scaledTime = (currentTime - ((startTime + endTime) / 2)) / ((endTime - startTime) / 8);
    const sincValue = this.sinc(scaledTime);
    const intensity = (sincValue + 1) / 2;

    if (Math.random() < 0.15) {
      this.bubbles.push(this.generateBubble(timeX, currentTime));
    }

    this.drawFunnel();
    this.updateAndDrawBubbles();
  }

  private animate() {
    if (!this.startTime) return;
    const elapsed = performance.now() - this.startTime;
    const progress = (elapsed % 2000) / 2000;
    this.drawFrame(progress);
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }
}