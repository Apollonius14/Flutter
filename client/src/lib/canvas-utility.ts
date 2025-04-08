import Matter from 'matter-js';

/**
 * Standard interface for particle objects
 */
export interface Particle {
  body: Matter.Body;
  groupId: number;
  cycleNumber: number;
  index: number; 
  energy: number; 
  initialEnergy: number;
  collided: number; // 0 = never collided, 1+ = collided at least once
}

/**
 * Standard interface for 2D points
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Flexible key type for particle grouping
 */
export type ParticleGroupKey = number | string;

/**
 * Groups particles by a key function
 * @param particles Array of particles to group
 * @param keyFn Function that returns a key for each particle
 * @returns Map of particle groups
 */
export function groupParticles<T extends ParticleGroupKey>(
  particles: Particle[],
  keyFn: (p: Particle) => T
): Map<T, Particle[]> {
  const groups = new Map<T, Particle[]>();
  
  for (const particle of particles) {
    const key = keyFn(particle);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(particle);
  }
  
  return groups;
}

/**
 * Calculates the centroid (average position) of a group of particles
 * @param particles Array of particles
 * @returns Point2D representing the centroid
 */
export function calculateCentroid(particles: Particle[]): Point2D {
  if (particles.length === 0) return { x: 0, y: 0 };
  
  const sum = particles.reduce(
    (acc, p) => ({ 
      x: acc.x + p.body.position.x, 
      y: acc.y + p.body.position.y 
    }),
    { x: 0, y: 0 }
  );
  
  return { 
    x: sum.x / particles.length, 
    y: sum.y / particles.length 
  };
}

/**
 * Styling options for bezier curves
 */
export interface BezierCurveStyle {
  strokeStyle: string;
  lineWidth: number;
}

/**
 * Draws a quadratic bezier curve through a series of centroids
 * @param ctx Canvas rendering context
 * @param centroids Array of points to connect with a curve
 * @param style Styling options for the curve
 * @param influenceFactor Factor controlling how much the curve can deviate (0-1)
 */
export function drawQuadraticBezierCurve(
  ctx: CanvasRenderingContext2D,
  centroids: Point2D[],
  style: BezierCurveStyle,
  influenceFactor: number = 0.3
): void {
  if (centroids.length < 3) return;
  
  ctx.beginPath();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  
  const startPoint = centroids[0];
  ctx.moveTo(startPoint.x, startPoint.y);
  
  // Draw intermediate segments
  for (let i = 1; i < centroids.length - 2; i++) {
    const c1 = centroids[i];
    const c2 = centroids[i + 1];
    
    // Use the midpoint between current and next as the bezier end
    const endX = (c1.x + c2.x) / 2;
    const endY = (c1.y + c2.y) / 2;
    
    // Apply linear blending constraint to control point
    const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
    const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
    
    // Calculate the midpoint of the line segment (reference line)
    const midX = (prevX + endX) / 2;
    const midY = (prevY + endY) / 2;
    
    // Apply linear blending constraint to limit control point deviation
    const controlX = midX + influenceFactor * (c1.x - midX);
    const controlY = midY + influenceFactor * (c1.y - midY);
    
    // Use the constrained control point
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
  }
  
  // Add the final segment if we have enough points
  if (centroids.length >= 3) {
    const last = centroids.length - 1;
    const secondLast = centroids.length - 2;
    
    // Apply same constraint to final segment
    const prevEndX = (centroids[secondLast-1].x + centroids[secondLast].x) / 2;
    const prevEndY = (centroids[secondLast-1].y + centroids[secondLast].y) / 2;
    const lastX = centroids[last].x;
    const lastY = centroids[last].y;
    
    // Reference midpoint
    const midX = (prevEndX + lastX) / 2;
    const midY = (prevEndY + lastY) / 2;
    
    // Constrained control point
    const controlX = midX + influenceFactor * (centroids[secondLast].x - midX);
    const controlY = midY + influenceFactor * (centroids[secondLast].y - midY);
    
    ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
  }
  
  ctx.stroke();
}

/**
 * Returns the angle of a particle's velocity in degrees (0-360)
 * @param particle The particle
 * @returns Angle in degrees
 */
export function getParticleAngle(particle: Particle): number {
  const velocity = particle.body.velocity;
  const angleRad = Math.atan2(velocity.y, velocity.x);
  return ((angleRad * 180 / Math.PI) + 360) % 360;
}

/**
 * Groups particles by their angle, useful for rendering wave patterns
 * @param particles Array of particles
 * @param numBuckets Number of angle buckets (determines resolution of grouping)
 * @returns Map of particles grouped by angle bucket
 */
export function groupParticlesByAngle(
  particles: Particle[], 
  numBuckets: number = 36
): Map<number, Particle[]> {
  return groupParticles(particles, (p) => {
    const angle = getParticleAngle(p);
    return Math.floor(angle / (360 / numBuckets));
  });
}

/**
 * Utility for calculating performance metrics like FPS
 */
export class PerformanceMonitor {
  private frameCount: number = 0;
  private lastTime: number = 0;
  private fps: number = 0;
  private updateInterval: number = 1000; // ms
  
  /**
   * Update the frame counter and calculate FPS
   * @param timestamp Current timestamp
   * @returns Current FPS
   */
  public update(timestamp: number): number {
    this.frameCount++;
    
    if (!this.lastTime) {
      this.lastTime = timestamp;
    }
    
    const elapsed = timestamp - this.lastTime;
    
    if (elapsed >= this.updateInterval) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = timestamp;
    }
    
    return this.fps;
  }
  
  /**
   * Get the current FPS
   * @returns Current FPS
   */
  public getFPS(): number {
    return this.fps;
  }
}