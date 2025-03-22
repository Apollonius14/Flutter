interface AnimationParams {
  turbulence: number;
  coherence: number;
  startTime: number;
  endTime: number;
  peakPower: number;
  pulseIntensity: number;
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  age: number;
  maxAge: number;
  intensity: number;
}

export class CanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
    this.params = {
      turbulence: 2.5,
      coherence: 2.5,
      startTime: 0,
      endTime: 100,
      peakPower: 5,
      pulseIntensity: 0,
    };

    this.canvas.style.backgroundColor = '#1a1a1a';
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
  }

  private animate() {
    if (!this.startTime) return;
    const elapsed = performance.now() - this.startTime;
    const progress = (elapsed % 2000) / 2000;
    this.drawFrame(progress);
    this.animationFrame = requestAnimationFrame(() => this.animate());
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

    // Calculate intensity from sinc wave at this position
    const normalizedX = x / this.canvas.width * 100;
    const midTime = (this.params.startTime + this.params.endTime) / 2;
    const timeWindow = this.params.endTime - this.params.startTime;
    const scaledTime = (normalizedX - midTime) / (timeWindow / 8);
    const sincValue = this.sinc(scaledTime);
    const intensity = (sincValue + 1) / 2;

    // Base radius now affected only by coherence
    const baseRadius = 4;
    const coherenceFactor = coherence / 5; // Normalize to 0-1
    const radiusMultiplier = coherenceFactor === 1 
      ? 1 // Perfect coherence = identical circles
      : Math.exp(
          (Math.random() - 0.5) * 2 * // Range -1 to 1
          (1 - coherenceFactor) * // Scale by inverse coherence
          Math.log(10) // Results in range 0.1x to 10x
        );

    const radius = baseRadius * radiusMultiplier;

    return {
      x,
      y: centerY, // Always at center
      radius,
      initialRadius: radius,
      age: 0,
      maxAge: 80,
      intensity
    };
  }

  private updateAndDrawBubbles() {
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      // Constant growth rate for all bubbles
      const growthFactor = 1 + (bubble.age / bubble.maxAge) * 2;
      bubble.radius = bubble.initialRadius * growthFactor;

      const opacity = 1 - (bubble.age / bubble.maxAge);

      const normalizedX = bubble.x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
                             normalizedX <= this.params.endTime;

      this.ctx.beginPath();
      this.ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);

      if (isInActiveWindow) {
        this.ctx.shadowColor = 'rgba(0, 200, 255, 0.6)';
        this.ctx.shadowBlur = 10;
        this.ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
        this.ctx.lineWidth = 1 + bubble.intensity * 16;
      } else {
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
        this.ctx.lineWidth = 0.5;
      }

      this.ctx.stroke();

      return bubble.age < bubble.maxAge;
    });
  }

  private drawFrame(progress: number) {
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

    // Circle generation rate based on pulse intensity (exponential scaling)
    const baseRate = 0.4;
    const maxMultiplier = Math.pow(10, this.params.pulseIntensity);
    if (Math.random() < (baseRate * maxMultiplier * intensity)) {
      this.bubbles.push(this.generateBubble(timeX, currentTime));
    }

    this.updateAndDrawBubbles();
  }
}