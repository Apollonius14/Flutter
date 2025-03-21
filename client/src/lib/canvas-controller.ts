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
    // Tighter scaling of x to concentrate the pulse
    const scaledX = x * 2;
    // Add exponential decay to reduce side lobes
    const decay = Math.exp(-Math.abs(x));
    return (Math.sin(Math.PI * scaledX) / (Math.PI * scaledX)) * decay;
  }

  private calculateSweepSpeed(normalizedTime: number): number {
    const { pulseIntensity, startTime, endTime } = this.params;

    if (pulseIntensity === 0) return 1;

    // Center of the time window
    const midTime = (startTime + endTime) / 2;
    const timeWindow = endTime - startTime;

    // Scale time to be centered around 0 for the sinc function
    const scaledTime = (normalizedTime * 100 - midTime) / (timeWindow / 8); // Tighter scaling

    // Calculate speed using sinc function
    const sincValue = this.sinc(scaledTime);
    const normalizedSinc = (sincValue + 1) / 2; // Normalize to 0-1 range

    // Double the intensity effect
    return 1 + normalizedSinc * pulseIntensity * 2;
  }

  private generateBubble(x: number, currentTime: number): Bubble {
    const { coherence } = this.params;
    const centerY = this.canvas.height / 2;

    // Base radius now increases with coherence (reversed from before)
    const baseRadius = 4 + coherence * 4; // Now scales up with coherence
    const radiusVariation = (5 - coherence) * 3; // Variation still decreases with coherence
    const radius = baseRadius + (Math.random() - 0.5) * radiusVariation;

    // Position variation based on coherence
    const yVariation = (5 - coherence) * 20; // Decreased variation for high coherence
    const y = centerY + (Math.random() - 0.5) * yVariation;

    return {
      x,
      y,
      radius,
      initialRadius: radius,
      age: 0,
      maxAge: 120,
    };
  }

  private updateAndDrawBubbles() {
    // Update existing bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      bubble.age++;

      // Growth factor based on age
      const growthFactor = 1 + (bubble.age / bubble.maxAge) * 1.5;
      bubble.radius = bubble.initialRadius * growthFactor;

      // Opacity decreases with age
      const opacity = 1 - (bubble.age / bubble.maxAge);

      // Determine if bubble is in the active time window
      const normalizedX = bubble.x / this.canvas.width * 100;
      const isInActiveWindow = normalizedX >= this.params.startTime &&
                             normalizedX <= this.params.endTime;

      // Draw bubble
      this.ctx.beginPath();
      this.ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);

      // Set stroke color based on whether bubble is in active window
      if (isInActiveWindow) {
        this.ctx.strokeStyle = `rgba(0, 100, 255, ${opacity})`;
      } else {
        this.ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.4})`;
      }

      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      return bubble.age < bubble.maxAge;
    });
  }

  private drawFrame(progress: number) {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    const { startTime, endTime, peakPower, coherence } = this.params;

    // Adjust progress based on sweep speed
    const sweepSpeed = this.calculateSweepSpeed(progress);
    const adjustedProgress = progress * sweepSpeed;

    // Draw time indicator line
    const timeX = width * adjustedProgress;
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Draw midpoint marker between start and end times
    const midX = width * ((startTime + endTime) / 200); // Divide by 200 because we're scaling 0-100 to 0-1
    this.ctx.beginPath();
    this.ctx.moveTo(midX, 0);
    this.ctx.lineTo(midX, height);
    this.ctx.strokeStyle = "rgba(255, 0, 0, 0.1)"; // Very faint red line
    this.ctx.stroke();

    // Calculate current time in ms based on progress
    const currentTime = adjustedProgress * 100;

    // Generate new bubbles at sweep line position (increased rate)
    if (Math.random() < 1.5) { // Increased from 0.3 to 1.5 (5x more bubbles)
      this.bubbles.push(this.generateBubble(timeX, currentTime));
    }

    // Update and draw all bubbles
    this.updateAndDrawBubbles();

    // Only draw arrow if we've reached start time
    if (currentTime < startTime) return;

    // Calculate arrow parameters
    const arrowStartX = width * (startTime / 100); // Start position based on startTime
    const arrowLength = width * ((endTime - startTime) / 100); // Length based on time window
    const centerY = height / 2;
    const maxThickness = height * 0.3 * (peakPower / 10);

    // Only draw up to the current time line position
    const drawWidth = Math.min(timeX - arrowStartX, arrowLength);
    if (drawWidth <= 0) return;

    // Draw arrow shaft with reduced opacity
    this.ctx.beginPath();
    this.ctx.moveTo(arrowStartX, centerY);
    this.ctx.lineTo(arrowStartX + drawWidth, centerY);

    // Style based on coherence with reduced opacity
    this.ctx.strokeStyle = `rgba(0, 0, 0, ${0.05 + coherence / 5 * 0.1})`; // Significantly reduced opacity
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

      this.ctx.fillStyle = `rgba(0, 0, 0, ${0.05 + coherence / 5 * 0.1})`; // Matching reduced opacity
      this.ctx.fill();
    }
  }
}