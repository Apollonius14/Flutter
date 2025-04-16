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
 * Renders a enhanced Bezier curve through a series of points with adaptive tension
 * and improved smoothing for more fluid appearance.
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
  // Need at least 3 points to draw a curve
  if (centroids.length < 3) return;
  
  ctx.beginPath();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  
  // Apply anti-aliasing for smoother lines
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Enable shadow for a subtle glow effect
  ctx.shadowColor = style.strokeStyle;
  ctx.shadowBlur = style.lineWidth * 0.7;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // Start at the first point
  const startPoint = centroids[0];
  ctx.moveTo(startPoint.x, startPoint.y);
  
  // Calculate segment lengths to adapt control point influence
  const segmentLengths: number[] = [];
  for (let i = 0; i < centroids.length - 1; i++) {
    const current = centroids[i];
    const next = centroids[i + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    segmentLengths.push(Math.sqrt(dx * dx + dy * dy));
  }
  
  // Calculate the average segment length for normalization
  const avgLength = segmentLengths.reduce((sum, len) => sum + len, 0) / segmentLengths.length;
  
  // Draw curve segments with adaptive tension based on segment length
  for (let i = 1; i < centroids.length - 2; i++) {
    const c1 = centroids[i];
    const c2 = centroids[i + 1];
    
    // Calculate segment-specific influence factor (shorter segments = less influence)
    const segmentLength = segmentLengths[i];
    const adaptiveFactor = influenceFactor * Math.min(1.2, segmentLength / avgLength);
    
    // Use the midpoint between current and next point as the bezier end point
    const endX = (c1.x + c2.x) / 2;
    const endY = (c1.y + c2.y) / 2;
    
    // Calculate the previous endpoint for control point calculation
    const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
    const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
    
    // Calculate the angle of the segment for directional bias
    const segmentAngle = Math.atan2(endY - prevY, endX - prevX);
    
    // Apply directional bias to favor horizontal flow (reduces vertical oscillation)
    const horizontalBias = 0.2;
    const xBias = Math.cos(segmentAngle) * horizontalBias;
    const yBias = Math.sin(segmentAngle) * horizontalBias;
    
    // Calculate the reference midpoint with directional bias
    const midX = (prevX + endX) / 2 + xBias;
    const midY = (prevY + endY) / 2 + yBias;
    
    // Apply adaptive influence factor to control point calculation
    const controlX = midX + adaptiveFactor * (c1.x - midX);
    const controlY = midY + adaptiveFactor * (c1.y - midY);
    
    // Draw the curve segment
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
  }
  
  // Add the final segment with special handling for end conditions
  if (centroids.length >= 3) {
    const last = centroids.length - 1;
    const secondLast = centroids.length - 2;
    const thirdLast = centroids.length - 3;
    
    // Previous endpoints and segment length
    const prevEndX = (centroids[thirdLast].x + centroids[secondLast].x) / 2;
    const prevEndY = (centroids[thirdLast].y + centroids[secondLast].y) / 2;
    const lastX = centroids[last].x;
    const lastY = centroids[last].y;
    
    // Calculate final segment length and adaptive factor
    const finalSegmentLength = segmentLengths[segmentLengths.length - 1];
    const finalAdaptiveFactor = influenceFactor * Math.min(1.2, finalSegmentLength / avgLength);
    
    // Calculate segment angle for directional bias
    const finalAngle = Math.atan2(lastY - prevEndY, lastX - prevEndX);
    const finalXBias = Math.cos(finalAngle) * 0.2;
    const finalYBias = Math.sin(finalAngle) * 0.2;
    
    // Calculate the midpoint with directional bias
    const midX = (prevEndX + lastX) / 2 + finalXBias;
    const midY = (prevEndY + lastY) / 2 + finalYBias;
    
    // Apply adaptive influence to final control point
    const controlX = midX + finalAdaptiveFactor * (centroids[secondLast].x - midX);
    const controlY = midY + finalAdaptiveFactor * (centroids[secondLast].y - midY);
    
    // Draw the final curve segment
    ctx.quadraticCurveTo(controlX, controlY, lastX, lastY);
  }
  
  // Apply stroke with high-quality rendering
  ctx.stroke();
  
  // Reset shadow settings
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
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