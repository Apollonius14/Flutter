import Matter from 'matter-js';

interface AnimationParams {
  coherence: number;
  startTime: number;
  endTime: number;
  pulseIntensity: number;
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  age: number;
  initialSpeed: number;
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
  private engine: Matter.Engine;
  private funnelWalls: Matter.Body[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 }
    });

    this.params = {
      coherence: 2.5,
      startTime: 0,
      endTime: 100,
      pulseIntensity: 0,
    };

    this.canvas.style.backgroundColor = '#1a1a1a';
    this.setupFunnelWalls();

    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;

        if (bodyA.collisionFilter.category === 0x0001 && bodyB.collisionFilter.category === 0x0002) {
          const particle = bodyA;
          const wall = bodyB;

          const wallAngle = wall.angle;
          const normalX = Math.sin(wallAngle);
          const normalY = -Math.cos(wallAngle);

          const v = particle.velocity;
          const speed = Math.sqrt(v.x * v.x + v.y * v.y);

          const dot = v.x * normalX + v.y * normalY;

          const reflectedVx = v.x - 2 * dot * normalX;
          const reflectedVy = v.y - 2 * dot * normalY;

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
    this.funnelWalls.forEach(wall => Matter.World.remove(this.engine.world, wall));
    this.funnelWalls = [];

    if (!this.funnelEnabled) return;

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    const centerY = height * 0.5;
    const gapSize = height * 0.2;
    const wallHeight = 10;
    const wallLength = height * 0.4;

    const wallOptions = {
      isStatic: true,
      render: { visible: true },
      friction: 0,
      restitution: 1.0,
      mass: 1000,
      density: 1,
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001
      }
    };

    const topWall = Matter.Bodies.rectangle(
      midX,
      centerY - gapSize / 2 - wallLength / 2,
      wallHeight,
      wallLength,
      {
        ...wallOptions,
        angle: 0
      }
    );

    const bottomWall = Matter.Bodies.rectangle(
      midX,
      centerY + gapSize / 2 + wallLength / 2,
      wallHeight,
      wallLength,
      {
        ...wallOptions,
        angle: 0
      }
    );

    this.funnelWalls = [topWall, bottomWall];
    this.funnelWalls.forEach(wall => Matter.World.add(this.engine.world, wall));
  }

  private generateBubbles(x: number): Bubble[] {
    const { coherence } = this.params;
    const centerY = this.canvas.height / 2;
    const height = this.canvas.height;

    const minWaves = 5;
    const maxWaves = 10;
    const numWaves = Math.floor(minWaves + (coherence / 5) * (maxWaves - minWaves));

    const bubbles: Bubble[] = [];
    const fixedRadius = 4;

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
      const timeWindow = this.params.endTime - this.params.startTime;
      const midTime = (this.params.startTime + this.params.endTime) / 2;
      const scaledTime = (normalizedX - midTime) / (timeWindow / 8);
      const sincValue = this.sinc(scaledTime);
      const intensity = (sincValue + 1) / 2;

      const particles: Particle[] = [];
      if (this.funnelEnabled) {
        const numParticles = 50; // Reduced from 100 to 50 for better performance
        for (let i = 0; i < numParticles; i++) {
          const angle = (i / numParticles) * Math.PI * 2;
          const particleX = x + Math.cos(angle) * fixedRadius;
          const particleY = y + Math.sin(angle) * fixedRadius;

          const body = Matter.Bodies.circle(particleX, particleY, 0.05, {
            friction: 0,
            restitution: 1.0,
            mass: 0.01,
            density: 0.001,
            collisionFilter: {
              category: 0x0001,
              mask: 0x0002
            },
            frictionAir: 0
          });

          const speed = 2.5;
          Matter.Body.setVelocity(body, {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
          });

          Matter.World.add(this.engine.world, body);

          particles.push({
            body,
            intensity,
            age: 0,
            initialSpeed: speed
          });
        }
      }

      bubbles.push({
        x,
        y,
        radius: fixedRadius,
        initialRadius: fixedRadius,
        age: 0,
        maxAge: 80 + intensity * 40,
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


  private drawFunnel() {
    if (!this.funnelEnabled) return;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;

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
        bubble.particles.forEach(particle => {
          const velocity = particle.body.velocity;
          const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
          if (currentSpeed !== 0) {
            const scaleFactor = particle.initialSpeed / currentSpeed;
            Matter.Body.setVelocity(particle.body, {
              x: velocity.x * scaleFactor,
              y: velocity.y * scaleFactor
            });
          }
        });

        this.ctx.beginPath();
        bubble.particles.forEach(particle => {
          const pos = particle.body.position;
          this.ctx.moveTo(pos.x, pos.y);
          this.ctx.arc(pos.x, pos.y, 0.05, 0, Math.PI * 2);
        });

        if (isInActiveWindow) {
          this.ctx.shadowColor = 'rgba(0, 200, 255, 0.8)';
          this.ctx.shadowBlur = 8;
          this.ctx.strokeStyle = 'rgba(0, 200, 255, 1.0)';
          this.ctx.lineWidth = 0.3 + bubble.intensity * 12;
        } else {
          const opacity = 1 - (bubble.age / bubble.maxAge);
          this.ctx.shadowBlur = 0;
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
          this.ctx.lineWidth = 0.25;
        }

        this.ctx.stroke();
      } else {
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
      for (let i = 0; i < 2; i++) {
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

    if (Math.random() < 0.15) {
      const newBubbles = this.generateBubbles(timeX);
      this.bubbles.push(...newBubbles);
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