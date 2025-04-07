// This is a standalone implementation of cycle-based renderer
// It's designed to be a drop-in modification for the existing renderSmoothWaves method

/**
 * Enhanced renderSmoothWaves that groups particles by cycle number first
 * This preserves visual coherence by keeping particles from the same generation together
 * 
 * @param ctx Canvas rendering context
 * @param nonCollidedParticles Array of particles that have never collided with the oval
 * @param collidedParticles Array of particles that have collided with the oval at least once
 */
private renderSmoothWavesByCycle(
  ctx: CanvasRenderingContext2D,
  nonCollidedParticles: Particle[],
  collidedParticles: Particle[]
) {
  // Helper to group particles by direction/angle
  const groupParticlesByDirection = (particles: Particle[]): Map<string, Particle[]> => {
    const buckets = new Map<string, Particle[]>();
    const ANGLE_BUCKETS = 36; // Number of angle buckets (10 degrees each)
    
    for (const particle of particles) {
      const body = particle.body;
      const velocity = body.velocity;
      
      // Calculate angle of movement (in radians)
      const angle = Math.atan2(velocity.y, velocity.x);
      
      // Normalize to 0-360 degrees and split into buckets
      const degrees = ((angle * 180 / Math.PI) + 360) % 360;
      const bucketIndex = Math.floor(degrees / (360 / ANGLE_BUCKETS));
      
      const key = bucketIndex.toString();
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(particle);
    }
    
    return buckets;
  };
  
  // Helper to calculate centroid (average position) of a group of particles
  const calculateCentroid = (particles: Particle[]): Point2D => {
    let sumX = 0;
    let sumY = 0;
    
    for (const particle of particles) {
      const position = particle.body.position;
      sumX += position.x;
      sumY += position.y;
    }
    
    return {
      x: sumX / particles.length,
      y: sumY / particles.length
    };
  };
  
  // NEW STEP: First group all particles by cycle number
  const nonCollidedByCycle = new Map<number, Particle[]>();
  const collidedByCycle = new Map<number, Particle[]>();
  
  // Group non-collided particles by cycle
  for (const particle of nonCollidedParticles) {
    const cycleNum = particle.cycleNumber;
    if (!nonCollidedByCycle.has(cycleNum)) {
      nonCollidedByCycle.set(cycleNum, []);
    }
    nonCollidedByCycle.get(cycleNum)!.push(particle);
  }
  
  // Group collided particles by cycle
  for (const particle of collidedParticles) {
    const cycleNum = particle.cycleNumber;
    if (!collidedByCycle.has(cycleNum)) {
      collidedByCycle.set(cycleNum, []);
    }
    collidedByCycle.get(cycleNum)!.push(particle);
  }
  
  // Draw smooth curves for non-collided particles, grouped by cycle
  for (const [cycleNum, particlesInCycle] of nonCollidedByCycle.entries()) {
    if (particlesInCycle.length > 5) { // Need enough particles for meaningful curve
      const buckets = groupParticlesByDirection(particlesInCycle);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket), // Convert string key to number
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(5, 255, 245, 0.95)"; // Brighter cyan
        ctx.lineWidth = 6;
        
        const startPoint = centroids[0];
        ctx.moveTo(startPoint.x, startPoint.y);
        
        // Linear blending constraint factor - controls how much the curve can deviate
        const influenceFactor = 0.3; // Lower values = less curve deviation
        
        // Use constrained quadratic curves through centroids
        for (let i = 1; i < centroids.length - 2; i++) {
          const c1 = centroids[i];
          const c2 = centroids[i + 1];
          
          // Use the midpoint between current and next as the bezier end
          const endX = (c1.x + c2.x) / 2;
          const endY = (c1.y + c2.y) / 2;
          
          // Apply linear blending constraint to control point
          // This pulls the control point closer to the line between adjacent midpoints
          // reducing the "pull" effect that causes wild deviations
          const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
          const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
          
          // Calculate the midpoint of the line segment (this is our reference line)
          const midX = (prevX + endX) / 2;
          const midY = (prevY + endY) / 2;
          
          // Apply linear blending constraint - limit control point deviation
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
    }
  }
  
  // Draw smooth curves for collided particles, grouped by cycle
  for (const [cycleNum, particlesInCycle] of collidedByCycle.entries()) {
    if (particlesInCycle.length > 5) {
      const buckets = groupParticlesByDirection(particlesInCycle);
      const centroids: Point2D[] = [];
      
      // Extract and sort centroids by angle bucket
      Array.from(buckets.entries())
        .map(([angleBucket, particles]) => {
          return {
            angleBucket: Number(angleBucket), // Convert string key to number
            centroid: calculateCentroid(particles),
            count: particles.length
          };
        })
        .filter(item => item.count >= 2) // Only use buckets with multiple particles
        .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
        .forEach(item => centroids.push(item.centroid));
      
      // Draw bezier curve through centroids if we have enough points
      if (centroids.length >= 4) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 120, 0.55)"; // Yellow but less bright
        ctx.lineWidth = 3.5;
        
        const startPoint = centroids[0];
        ctx.moveTo(startPoint.x, startPoint.y);
        
        // Linear blending constraint factor - controls how much the curve can deviate
        // Slightly higher for collided particles to allow more deviation
        const influenceFactor = 0.35; // Lower values = less curve deviation
        
        // Use constrained quadratic curves through centroids
        for (let i = 1; i < centroids.length - 2; i++) {
          const c1 = centroids[i];
          const c2 = centroids[i + 1];
          
          // Use the midpoint between current and next as the bezier end
          const endX = (c1.x + c2.x) / 2;
          const endY = (c1.y + c2.y) / 2;
          
          // Apply linear blending constraint to control point
          // This pulls the control point closer to the line between adjacent midpoints
          // reducing the "pull" effect that causes wild deviations
          const prevX = i === 1 ? startPoint.x : (centroids[i-1].x + c1.x) / 2;
          const prevY = i === 1 ? startPoint.y : (centroids[i-1].y + c1.y) / 2;
          
          // Calculate the midpoint of the line segment (this is our reference line)
          const midX = (prevX + endX) / 2;
          const midY = (prevY + endY) / 2;
          
          // Apply linear blending constraint - limit control point deviation
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
    }
  }
}

// ========================== INTEGRATION INSTRUCTIONS ==========================
// To use this enhanced renderer:
// 
// 1. Copy the entire renderSmoothWavesByCycle method into CanvasController class
// 
// 2. Replace the renderSmoothWaves method call in drawFrame with:
//    if (this.params.showWaves) {
//      if (this.params.showSmooth) {
//        // Use the new cycle-based renderer
//        this.renderSmoothWavesByCycle(ctx, nonCollidedParticles, collidedParticles);
//      } else {
//        // Keep using the simple linear waves
//        this.renderWaves(ctx);
//      }
//    }
//
// 3. If any compatibility issues arise, revert to the original renderer
//    by restoring the original renderSmoothWaves call.
// ============================================================================