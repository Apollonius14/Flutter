import * as Matter from 'matter-js';
import { Particle } from './canvas-utility';

/**
 * Interface for a particle template that stores pre-calculated values for use in particle generation
 */
export interface ParticleTemplate {
  angleRadians: number;      // Angle in radians 
  offsetX: number;           // X offset from center at unit radius
  offsetY: number;           // Y offset from center at unit radius
  velocityX: number;         // X velocity component
  velocityY: number;         // Y velocity component
}

/**
 * Interface for a bubble size template that pre-calculates size multipliers
 */
export interface BubbleSizeTemplate {
  positionY: number;         // Y position for this bubble
  sizeMultiplier: number;    // Size multiplier for this bubble (0.7-2.1)
}

/**
 * Generates pre-calculated particle templates for efficient particle creation
 * This is a major performance optimization that eliminates redundant calculations
 * 
 * @param particleCount Number of particles to generate templates for
 * @param baseSpeed Base speed for particle velocity
 * @returns Array of particle templates with pre-calculated values
 */
export function generateParticleTemplates(particleCount: number, baseSpeed: number = 4): ParticleTemplate[] {
  const templates: ParticleTemplate[] = [];
  const halfCount = Math.floor(particleCount / 2);
  
  // Add center particle at 0°
  templates.push({
    angleRadians: 0,
    offsetX: 1,
    offsetY: 0,
    velocityX: baseSpeed * 1.2,
    velocityY: 0
  });
  
  // Add symmetric pairs of particles
  for (let i = 1; i <= halfCount; i++) {
    const angle = (i / halfCount) * Math.PI;
    
    // Add positive angle particle
    templates.push({
      angleRadians: angle,
      offsetX: Math.cos(angle),
      offsetY: Math.sin(angle),
      velocityX: Math.cos(angle) * baseSpeed * 1.2,
      velocityY: Math.sin(angle) * baseSpeed * 0.9
    });
    
    // Add negative angle particle
    templates.push({
      angleRadians: -angle,
      offsetX: Math.cos(-angle),
      offsetY: Math.sin(-angle),
      velocityX: Math.cos(-angle) * baseSpeed * 1.2,
      velocityY: Math.sin(-angle) * baseSpeed * 0.9
    });
  }
  
  // Sort templates by angle for consistent indexing
  return templates.sort((a, b) => a.angleRadians - b.angleRadians);
}

/**
 * Generates bubble size templates with bow curve distribution (center bubbles larger)
 * 
 * @param canvasHeight Canvas height
 * @param waveCount Number of wave positions
 * @param minMultiplier Minimum size multiplier (at edges)
 * @param maxMultiplier Maximum size multiplier (at center)
 * @returns Array of size templates with positions and multipliers
 */
export function generateBubbleSizeTemplates(
  canvasHeight: number,
  waveCount: number = 15,
  minMultiplier: number = 0.7,
  maxMultiplier: number = 2.1
): BubbleSizeTemplate[] {
  const templates: BubbleSizeTemplate[] = [];
  const compressionFactor = 0.2;
  const center = canvasHeight / 2;
  const baseSpacing = (canvasHeight * compressionFactor) / (waveCount + 1);
  const halfSpacing = baseSpacing / 2;
  
  // Calculate positions array
  const positions: number[] = [];
  
  // Add positions from top to bottom, offset from center
  for (let i = 3; i >= 0.5; i -= 0.5) {
    positions.push(center - halfSpacing - baseSpacing * i);
  }
  positions.push(center - halfSpacing - baseSpacing);
  positions.push(center);
  positions.push(center + halfSpacing + baseSpacing);
  for (let i = 0.5; i <= 3; i += 0.5) {
    positions.push(center + halfSpacing + baseSpacing * i);
  }
  
  // Generate size templates with bow curve distribution
  positions.forEach(posY => {
    // Calculate normalized position (-1 to 1, where 0 is center)
    const normalizedPos = (posY - center) / (canvasHeight / 2);
    
    // Use cosine function to create bow curve effect
    // cos(0) = 1 (center), cos(±π) = -1 (edges)
    const multiplier = minMultiplier + (maxMultiplier - minMultiplier) * 
      (0.5 + 0.5 * Math.cos(normalizedPos * Math.PI));
    
    templates.push({
      positionY: posY,
      sizeMultiplier: multiplier
    });
  });
  
  return templates;
}

/**
 * Creates a particle using the pre-calculated template values
 * This is much more efficient than recalculating angles and offsets for each particle
 * 
 * @param template Particle template with pre-calculated values
 * @param x Center X position
 * @param y Center Y position
 * @param radius Bubble radius
 * @param groupId Group ID for the new particle
 * @param cycleNumber Cycle number for the new particle
 * @param power Initial energy/power value
 * @param index Index of the particle in its group
 * @returns New Particle object
 */
export function createParticleFromTemplate(
  template: ParticleTemplate,
  x: number,
  y: number,
  radius: number,
  groupId: number,
  cycleNumber: number,
  power: number,
  index: number
): Particle {
  const particleX = x + template.offsetX * radius;
  const particleY = y + template.offsetY * radius;
  
  // Create physics body
  const body = Matter.Bodies.circle(particleX, particleY, 0.1, {
    friction: 0.0,
    frictionAir: 0.0,
    frictionStatic: 0.0,
    restitution: 1.0,
    mass: 1,
    inertia: Infinity,
    slop: 0.01,
    collisionFilter: {
      category: 0x0001,
      mask: 0x0002,
      group: 0
    }
  });
  
  // Set velocity using template values
  Matter.Body.setVelocity(body, {
    x: template.velocityX,
    y: template.velocityY
  });
  
  // Create and return particle object
  return {
    body,
    groupId,
    cycleNumber,
    index,
    energy: power,
    initialEnergy: power,
    collided: 0
  };
}