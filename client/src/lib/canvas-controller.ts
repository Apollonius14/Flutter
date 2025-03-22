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
      frequency: 0.075  // Reduced from 0.15
    };

    this.canvas.style.backgroundColor = '#1a1a1a';
    this.setupFunnelWalls();
  }

  private setupFunnelWalls() {
    this.funnelWalls.forEach(wall => Matter.World.remove(this.engine.world, wall));
    this.funnelWalls = [];

    if (!this.funnelEnabled) return;

    const { width, height } = this.canvas;
    const midX = width * 0.5;
    const centerY = height * 0.5;
    const gapSize = height * 0.2;
    const wallThickness = 20; // Increased from 10 to ensure solid collision
    const wallLength = height * 0.4;

    const wallOptions = {
      isStatic: true,
      render: { visible: true },
      friction: 0,
      restitution: 0.7,  // Changed from 1.0
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001
      }
    };

    const topWall = Matter.Bodies.rectangle(
      midX,
      centerY - gapSize/2 - wallLength/2,
      wallThickness,
      wallLength,
      {
        ...wallOptions,
        angle: 0
      }
    );

    const bottomWall = Matter.Bodies.rectangle(
      midX,
      centerY + gapSize/2 + wallLength/2,
      wallThickness,
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

    const minWaves = 2; // Reduced from 4
    const maxWaves = 4; // Reduced from 8
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
      const isInActiveWindow = normalizedX >= this.params.startTime &&
        normalizedX <= this.params.endTime;
      const intensity = isInActiveWindow ? 1.0 : 0.3;

      const particles: Particle[] = [];
      if (this.funnelEnabled) {
        const numParticles = 30; //Increased from 25
        for (let i = 0; i < numParticles; i++) {
          const angle = (i / numParticles) * Math.PI * 2;
          const particleX = x + Math.cos(angle) * fixedRadius;
          const particleY = y + Math.sin(angle) * fixedRadius;

          const body = Matter.Bodies.circle(particleX, particleY, 0.025, { // Reduced from 0.05
            friction: 0,
            restitution: 0.7, // Changed from 1.0
            mass: 0.1,
            collisionFilter: {
              category: 0x0001,
              mask: 0x0002,
              group: -1
            },
            frictionAir: 0
          });

          const speed = 2.0; // Reduced from 4.0
          Matter.Body.setVelocity(body, {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
          });

          Matter.World.add(this.engine.world, body);

          particles.push({
            body,
            intensity,
            age: 0
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

    const timeX = width * progress;

    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    const midX = width * ((this.params.startTime + this.params.endTime) / 200);
    this.ctx.beginPath();
    this.ctx.moveTo(midX, 0);
    this.ctx.lineTo(midX, height);
    this.ctx.strokeStyle = "rgba(255, 50, 50, 0.05)";
    this.ctx.stroke();

    if (Math.random() < this.params.frequency) {
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