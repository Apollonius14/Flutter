import Matter from 'matter-js';

// Interface for a particle in the simulation
export interface Particle {
  body: Matter.Body;
  groupId: number;
  cycleNumber: number;
  index: number; 
  energy: number; 
  initialEnergy: number;
  collided: number; // 0 = never collided, 1+ = collided at least once
}

// Interface for 2D point coordinates
export interface Point2D {
  x: number;
  y: number;
}

// Generic key type for particle grouping
export type ParticleGroupKey = number | string;

/**
 * Groups particles based on a key generating function
 * @param particles Array of particles to group
 * @param keyFn Function that generates a key for each particle
 * @returns Map of keys to arrays of particles
 */
export function groupParticles<K extends ParticleGroupKey>(
  particles: Particle[],
  keyFn: (particle: Particle) => K
): Map<K, Particle[]> {
  const groups = new Map<K, Particle[]>();
  
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
 * Calculate centroid (average position) of a group of particles
 * @param particles Array of particles
 * @returns Point2D representing the centroid
 */
export function calculateCentroid(particles: Particle[]): Point2D {
  if (particles.length === 0) return { x: 0, y: 0 };
  
  let sumX = 0;
  let sumY = 0;
  
  for (const particle of particles) {
    sumX += particle.body.position.x;
    sumY += particle.body.position.y;
  }
  
  return {
    x: sumX / particles.length,
    y: sumY / particles.length
  };
}

/**
 * Calculates direction angle of a particle in degrees
 * @param particle Particle to calculate direction for
 * @param bucketSize Size of angle buckets in degrees
 * @returns Bucketed angle in degrees
 */
export function getParticleDirectionAngle(particle: Particle, bucketSize: number = 5): number {
  const velocity = particle.body.velocity;
  const angleRad = Math.atan2(velocity.y, velocity.x);
  const angleDeg = angleRad * 180 / Math.PI;
  return Math.round(angleDeg / bucketSize) * bucketSize;
}

/**
 * Renders a quadratic Bezier curve through a series of points
 * @param ctx Canvas rendering context
 * @param centroids Array of points to draw curve through
 * @param style Object containing strokeStyle and lineWidth
 * @param influenceFactor Factor controlling curve deviation (0-1)
 */
export function drawQuadraticBezierCurve(
  ctx: CanvasRenderingContext2D,
  centroids: Point2D[],
  style: { strokeStyle: string; lineWidth: number },
  influenceFactor: number = 0.3
): void {
  if (centroids.length < 3) return;
  
  ctx.beginPath();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  
  const startPoint = centroids[0];
  ctx.moveTo(startPoint.x, startPoint.y);
  
  // Draw curve segments
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
    
    // Apply linear blending constraint - limit control point deviation
    const controlX = midX + influenceFactor * (c1.x - midX);
    const controlY = midY + influenceFactor * (c1.y - midY);
    
    // Draw the curve segment
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
 * Calculate line width based on particle count using a square function
 * @param particleCount Number of particles
 * @param baseThickness Base thickness multiplier
 * @param maxThickness Maximum thickness allowed
 * @param normalizer Value to normalize particle count
 * @returns Calculated line width
 */
export function calculateLineThickness(
  particleCount: number,
  baseThickness: number = 3.5,
  maxThickness: number = 15,
  normalizer: number = 30
): number {
  return Math.min(maxThickness, baseThickness * Math.pow(particleCount / normalizer, 2));
}