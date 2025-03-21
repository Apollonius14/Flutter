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
  intensity: number; // Added intensity property
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
    const progress = (elapsed % 2000) / 2000; // 2 second animation loop

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
    const intensity = (sincValue + 1) / 2; // Normalize to 0-1 range

    // Base radius now increases with coherence
    const baseRadius = 4 + coherence * 2;
    const radiusVariation = (5 - coherence) * 1.5;
    const radius = baseRadius + (Math.random() - 0.5) * radiusVariation;

    // Position variation based on coherence
    const yVariation = (5 - coherence) * 20;
    const y = centerY + (Math.random() - 0.5) * yVariation;

    return {
      x,
      y,
      radius,
      initialRadius: radius,
      age: 0,
      maxAge: 80 + intensity * 40, // Longer lifetime for high intensity
      intensity // Store intensity for later use
    };
  }

  private updateAndDrawBubbles() {
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      // Growth factor increases with intensity - doubled effect
      const baseGrowth = 2 + bubble.intensity * 4; // Doubled from 1.5 + intensity to 2 + intensity * 4
      const growthFactor = 1 + (bubble.age / bubble.maxAge) * baseGrowth;
      bubble.radius = bubble.initialRadius * growthFactor;

      // Opacity decreases with age
      const opacity = 1 - (bubble.age / bubble.maxAge);

      // Determine if bubble is in the active time window
      const normalizedX = bubble.x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
                             normalizedX <= this.params.endTime;

      // Draw bubble with enhanced border thickness based on intensity
      this.ctx.beginPath();
      this.ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);

      // Set stroke color and width based on whether bubble is in active window
      if (isInActiveWindow) {
        // More vibrant blue with slight glow effect
        this.ctx.shadowColor = 'rgba(0, 150, 255, 0.5)';
        this.ctx.shadowBlur = 5;
        this.ctx.strokeStyle = `rgba(0, 150, 255, ${opacity})`;
        this.ctx.lineWidth = 1 + bubble.intensity * 4; // Doubled from 2 to 4
      } else {
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.2})`; // Reduced from 0.4 to 0.2
        this.ctx.lineWidth = 0.5; // Reduced from 1 to 0.5
      }

      this.ctx.stroke();

      return bubble.age < bubble.maxAge;
    });
  }

  private drawFrame(progress: number) {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    const { startTime, endTime, peakPower, coherence } = this.params;

    // Use constant speed for sweep line
    const timeX = width * progress;

    // Draw time indicator line
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.1)"; // Reduced from 0.2 to 0.1
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Draw midpoint marker between start and end times
    const midX = width * ((startTime + endTime) / 200);
    this.ctx.beginPath();
    this.ctx.moveTo(midX, 0);
    this.ctx.lineTo(midX, height);
    this.ctx.strokeStyle = "rgba(255, 0, 0, 0.05)"; // Reduced from 0.1 to 0.05
    this.ctx.stroke();

    // Calculate current time in ms based on progress
    const currentTime = progress * 100;

    // Generate new bubbles with enhanced intensity effect
    const scaledTime = (currentTime - ((startTime + endTime) / 2)) / ((endTime - startTime) / 8);
    const sincValue = this.sinc(scaledTime);
    const intensity = (sincValue + 1) / 2;

    // Generate more bubbles when intensity is higher
    if (Math.random() < (0.6 + intensity * 0.8)) {
      this.bubbles.push(this.generateBubble(timeX, currentTime));
    }

    // Update and draw all bubbles
    this.updateAndDrawBubbles();

    // Only draw arrow if we've reached start time
    if (currentTime < startTime) return;

    // Draw arrow with further reduced opacity
    const arrowStartX = width * (startTime / 100);
    const arrowLength = width * ((endTime - startTime) / 100);
    const centerY = height / 2;
    const maxThickness = height * 0.3 * (peakPower / 10);

    const drawWidth = Math.min(timeX - arrowStartX, arrowLength);
    if (drawWidth <= 0) return;

    this.ctx.beginPath();
    this.ctx.moveTo(arrowStartX, centerY);
    this.ctx.lineTo(arrowStartX + drawWidth, centerY);

    // Reduced arrow opacity
    this.ctx.strokeStyle = `rgba(0, 0, 0, ${0.025 + coherence / 5 * 0.05})`; // Halved from 0.05 to 0.025
    this.ctx.lineWidth = maxThickness;
    this.ctx.lineCap = "round";
    this.ctx.stroke();

    // Draw arrowhead only if we've reached the end
    if (timeX >= arrowStartX + arrowLength) {
      const arrowTip = arrowStartX + arrowLength;
      const arrowheadLength = maxThickness;
      const arrowheadWidth = maxThickness * 0.8;

      this.ctx.beginPath();
      this.ctx.moveTo(arrowTip, centerY);
      this.ctx.lineTo(arrowTip - arrowheadLength, centerY - arrowheadWidth);
      this.ctx.lineTo(arrowTip - arrowheadLength, centerY + arrowheadWidth);
      this.ctx.closePath();

      this.ctx.fillStyle = `rgba(0, 0, 0, ${0.025 + coherence / 5 * 0.05})`; // Matching reduced opacity
      this.ctx.fill();
    }
  }
}