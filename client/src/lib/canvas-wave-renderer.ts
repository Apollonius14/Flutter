import { Particle, Point2D, groupParticles, calculateCentroid, drawQuadraticBezierCurve, calculateLineThickness } from './canvas-utility';

/**
 * Enhanced renderer implementation for smooth waves grouped by cycle
 * 
 * This renderer has several advantages:
 * 1. Groups particles by cycle number first, maintaining visual coherence
 * 2. Handles non-collided and collided particles separately with different styling
 * 3. Uses advanced curve generation with constrained control points
 * 4. Implements dynamic line width based on particle count
 * 
 * @param ctx Canvas rendering context
 * @param nonCollidedParticles Array of particles that have never collided with the oval
 * @param collidedParticles Array of particles that have collided with the oval at least once
 */
export function renderSmoothWavesByCycle(
  ctx: CanvasRenderingContext2D,
  nonCollidedParticles: Particle[],
  collidedParticles: Particle[]
): void {
  // Helper to group particles by direction/angle
  const groupParticlesByDirection = (particles: Particle[]): Map<string, Particle[]> => {
    // Use angle bucket size of 10 degrees for grouping
    const ANGLE_BUCKET_SIZE = 10;
    
    return groupParticles(particles, (particle) => {
      const body = particle.body;
      const velocity = body.velocity;
      
      // Calculate angle of movement (in radians)
      const angle = Math.atan2(velocity.y, velocity.x);
      
      // Normalize to 0-360 degrees and split into buckets
      const degrees = ((angle * 180 / Math.PI) + 360) % 360;
      const bucketIndex = Math.floor(degrees / ANGLE_BUCKET_SIZE);
      
      return bucketIndex.toString();
    });
  };
  
  // First group all particles by cycle number
  const nonCollidedByCycle = groupParticles(nonCollidedParticles, p => p.cycleNumber);
  const collidedByCycle = groupParticles(collidedParticles, p => p.cycleNumber);
  
  // Draw smooth curves for non-collided particles, grouped by cycle
  const nonCollidedEntries = Array.from(nonCollidedByCycle.entries());
  for (let i = 0; i < nonCollidedEntries.length; i++) {
    const [cycleNum, particlesInCycle] = nonCollidedEntries[i];
    
    if (particlesInCycle.length > 5) { // Need enough particles for meaningful curve
      const buckets = groupParticlesByDirection(particlesInCycle);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket),
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        // Calculate line thickness based on particle count with a square function
        const lineThickness = calculateLineThickness(
          particlesInCycle.length,
          3.5,  // Base thickness
          15,   // Max thickness
          30    // Normalizer
        );
        
        // Draw using utility function
        drawQuadraticBezierCurve(
          ctx,
          centroids,
          { 
            strokeStyle: "rgba(5, 255, 245, 0.95)", // Bright cyan
            lineWidth: lineThickness
          },
          0.3 // Influence factor - controls curve smoothness
        );
      }
    }
  }
  
  // Draw smooth curves for collided particles, grouped by cycle
  const collidedEntries = Array.from(collidedByCycle.entries());
  for (let i = 0; i < collidedEntries.length; i++) {
    const [cycleNum, particlesInCycle] = collidedEntries[i];
    
    if (particlesInCycle.length > 5) {
      const buckets = groupParticlesByDirection(particlesInCycle);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket),
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        // Calculate line thickness based on particle count with a square function
        const lineThickness = calculateLineThickness(
          particlesInCycle.length,
          2.5,  // Base thickness (thinner than non-collided)
          12,   // Max thickness (less than non-collided)
          30    // Normalizer
        );
        
        // Draw using utility function
        drawQuadraticBezierCurve(
          ctx,
          centroids,
          { 
            strokeStyle: "rgba(255, 255, 120, 0.55)", // Yellow but less bright
            lineWidth: lineThickness
          },
          0.35 // Slightly higher for collided particles to allow more deviation
        );
      }
    }
  }
}