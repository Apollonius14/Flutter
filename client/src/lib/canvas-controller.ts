import * as Matter from 'matter-js';

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; // Normalized position (0-1) for oval's horizontal position
  ovalEccentricity: number; // 0-1 value representing eccentricity
}

interface Particle {
  body: Matter.Body;
  intensity: number;
  groupId: number;
  cycleNumber: number;
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  intensity: number;
  particles: Particle[];
  groupId: number;
  cycleNumber: number;
  energy: number;
  initialEnergy: number;
}

export class CanvasController {
  // Core timing constants
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.6; // Cycle duration in milliseconds
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 3; // How many cycles particles live
  private static readonly PHYSICS_TIMESTEP_MS: number = 12.5; // Physics engine update interval (80fps)
  // Layout constants
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; // 30% of canvas width
  // Particle appearance constants
  private static readonly OPACITY_DECAY_RATE: number = 0.01; // How much opacity decreases per cycle
  private static readonly BASE_LINE_WIDTH: number = 2.7; // Base thickness for particle trails
  private static readonly PARTICLES_PER_RING: number = 13; // Number of particles in each ring
  private static readonly PARTICLE_RADIUS: number = 0.5; // Physics body radius for particles
  private static readonly FIXED_BUBBLE_RADIUS: number = 7.2; // Fixed radius for bubbles

  // State variables
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWidth: number;
  private canvasHeight: number;
  private params: AnimationParams;
  private animationFrame: number | null = null;
  private startTime: number | null = null;
  private bubbles: Bubble[] = [];
  private engine: Matter.Engine;
  private previousSweepLineX: number = 0;
  private activationLineX: number = 0;
  private lastSpawnTime: number = 0;
  private spawnInterval: number = 1000;
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null;
  private currentGroupId: number = 0;
  private currentCycleNumber: number = 0;
  private positions: number[] = [];
  private isRTL: boolean = false;
  private showParticles: boolean = true;
  private ovalBody: Matter.Composite | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 3,
      velocityIterations: 3,
      constraintIterations: 2,
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5, // Default to center
      ovalEccentricity: 0.7 // Default eccentricity
    };

    this.activationLineX = canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';
    
    // Initialize the oval if needed
    this.updateOval();
  }

  
  /**
   * Calculate thickness factor based on wave position
   * Enhanced to make differences between waves more pronounced
   */
  private calculateThicknessFactor(waveIndex: number): number {
    const centralPositions = [4, 5];
    const innerPositions = [3, 6];
    const middlePositions = [2, 7];
    const outerPositions = [1, 8];
    const farthestPositions = [0, 9];

    // Increased thickness factors for more visual distinction between waves
    if (centralPositions.includes(waveIndex)) return 2.0;    // Was 1.8
    if (innerPositions.includes(waveIndex)) return 1.4;      // Was 1.6
    if (middlePositions.includes(waveIndex)) return 1.2;     // Was 1.3
    if (outerPositions.includes(waveIndex)) return 0.9;      // Was 1.05
    if (farthestPositions.includes(waveIndex)) return 0.8;   // Was 1.0

    return 0.8;
  }

  /**
   * Generate particle angles for a wave ring with a forward-focused distribution
   */
  private generateParticleAngles(particleCount: number): number[] {
    const particleAngles: number[] = [];
    const baseAngles: number[] = [];
    const halfCount = Math.floor(particleCount / 2);

    // Add center particle at 0°
    baseAngles.push(0);

    // Add symmetric pairs of particles
    for (let i = 1; i <= halfCount; i++) {
      const angle = (i / halfCount) * Math.PI;
      baseAngles.push(angle);
      baseAngles.push(-angle);
    }

    // Apply compression to focus particles toward the front
    for (const angle of baseAngles) {
      const absAngle = Math.abs(angle);
      const compressionFactor = (absAngle / Math.PI) * (absAngle / Math.PI);
      const transformedAngle = angle * (1 - 0.5 * compressionFactor);
      const normalizedAngle = (transformedAngle + 2 * Math.PI) % (2 * Math.PI);

      particleAngles.push(normalizedAngle);
    }

    return particleAngles.sort((a, b) => a - b);
  }



  /**
   * Calculate wave positions across the canvas height
   */
  private calculateWavePositions(canvasHeight: number): number[] {
    const positions: number[] = [];
    // Keep the compression factor high to spread the 9 positions across the increased canvas height
    const compressionFactor = 0.3; // Higher value to use more vertical space
    const center = canvasHeight / 2;
    const numPositions = 9; // Back to the original 9 positions as requested
    const baseSpacing = (canvasHeight * compressionFactor) / (numPositions + 2);
    const halfSpacing = baseSpacing / 2;

    // Add positions from top to bottom, offset from center
    // Using exactly 9 positions but spread across the taller canvas
    positions.push(center - halfSpacing - baseSpacing * 4);
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center); // Center position (no offset)
    positions.push(center + halfSpacing + baseSpacing);
    positions.push(center + halfSpacing + baseSpacing * 2);
    positions.push(center + halfSpacing + baseSpacing * 3);
    positions.push(center + halfSpacing + baseSpacing * 4);

    return positions;
  }

  private generateBubbles(x: number): Bubble[] {
    const { power } = this.params;
    const height = this.canvas.height;
    const width = this.canvas.width;

    const bubbles: Bubble[] = [];
    const baseRadius = CanvasController.FIXED_BUBBLE_RADIUS;

    // Calculate wave positions using our helper method
    this.positions = this.calculateWavePositions(height);

    // Always use the activation line position for spawning particles
    // This ensures particles only appear at the activation line
    x = this.activationLineX;

    // Find the center position for radius calculation
    const centerY = height / 2;

    this.positions.forEach(y => {
      // Calculate a radius multiplier based on the distance from center
      // Use a cosine function to create a smooth bow curve
      // Normalize the position to be between -1 and 1, where 0 is center
      const normalizedPos = (y - centerY) / (height / 2);
      
      // Use cosine function to create a smooth curve, with center being largest
      // Multiplier will be between 0.7 (edges) and 2.1 (center) - 3x difference
      const radiusMultiplier = 0.7 + 1.4 * Math.cos(normalizedPos * Math.PI);
      
      // Apply the multiplier to get the actual radius for this position
      const bubbleRadius = baseRadius * radiusMultiplier;
      
      const intensity = 2.0;

      // Generate a unique group ID for this ring of particles
      const groupId = this.currentGroupId++;

      const particles: Particle[] = [];
      // Use our constant for the number of particles per ring
      const numParticlesInRing = CanvasController.PARTICLES_PER_RING;

      // Keep track of power factor for maxAge calculation
      const particlePowerFactor = this.params.power / 3; // Adjusted for new triple lifetime

      // Generate the particle angles using our helper method
      const particleAngles = this.generateParticleAngles(numParticlesInRing);

      // Create particles at the calculated angles
      for (const angle of particleAngles) {
        const particleX = x + Math.cos(angle) * bubbleRadius;
        const particleY = y + Math.sin(angle) * bubbleRadius;

        // Create physics body with size from our constant
        const body = Matter.Bodies.circle(particleX, particleY, CanvasController.PARTICLE_RADIUS, {
          friction: 0.0,     // No friction to prevent energy loss 
          restitution: 1.0,  // Perfect elasticity (no energy loss)
          mass: 0.2,         // Standard mass
          frictionAir: 0,    // No air resistance
          collisionFilter: {
            category: 0x0001,
            mask: 0x0002,    // Only collide with the oval (0x0002), not other particles
            group: 0        // Using 0 instead of -1 to rely on mask for collision rules
          }
        });

        const baseSpeed = 3.9; 
        const horizontalAlignment = Math.abs(Math.cos(angle));

        const directedSpeed = baseSpeed * (1 + 0.7 * horizontalAlignment);

        // Set velocity - still using the original angle, but with adjusted speed
        Matter.Body.setVelocity(body, {
          x: Math.cos(angle) * directedSpeed,
          y: Math.sin(angle) * directedSpeed
        });

        Matter.Composite.add(this.engine.world, body);
        // Create a properly typed particle with cycle number
        const particle: Particle = {
          body,
          intensity: intensity,
          groupId: groupId,  // Assign the same group ID to all particles in this ring
          cycleNumber: this.currentCycleNumber  // Assign current cycle number
        };
        particles.push(particle);
        }

      bubbles.push({
        x,
        y,
        radius: bubbleRadius,
        initialRadius: bubbleRadius,
        intensity: intensity,
        particles,
        groupId: groupId,  // Assign the same group ID to the bubble
        cycleNumber: this.currentCycleNumber,  // Assign current cycle number
        energy: this.params.power,
        initialEnergy: this.params.power
      });
    });

    return bubbles;
  }

  private initializeBubble(x: number, y: number, intensity: number): Bubble {
    return {
      x,
      y,
      radius: CanvasController.FIXED_BUBBLE_RADIUS,
      initialRadius: CanvasController.FIXED_BUBBLE_RADIUS,
      intensity,
      particles: [],
      groupId: this.currentGroupId++,
      cycleNumber: this.currentCycleNumber,
      energy: this.params.power,
      initialEnergy: this.params.power,
    };
  }

  private updateBubbleEnergy(bubble: Bubble) {
    bubble.energy = Math.max(0, bubble.energy - (bubble.initialEnergy * 0.002));
  }
  
  /**
   * Groups particles by cycle and direction to create more coherent wave patterns
   * @returns Map of cycle numbers to arrays of particle groups
   */
  private groupParticlesByCycleAndDirection(): Map<number, Particle[][]> {
    // Map to store groups by cycle number
    const groupsByCycle = new Map<number, Particle[][]>();
    
    // First, collect all visible particles from each cycle
    const visibleParticlesByCycle = new Map<number, Particle[]>();
    
    this.bubbles.forEach(bubble => {
      // Skip bubbles with no energy
      if (bubble.energy <= 0) return;
      
      // Get cycle number for this bubble
      const cycleNum = bubble.cycleNumber;
      
      // Get all visible particles from this bubble
      const visibleBubbleParticles = bubble.particles.filter(p => {
        const pos = p.body.position;
        return pos.x >= 0 && pos.x <= this.canvas.width && 
               pos.y >= 0 && pos.y <= this.canvas.height;
      });
      
      // Add to the cycle map
      if (!visibleParticlesByCycle.has(cycleNum)) {
        visibleParticlesByCycle.set(cycleNum, []);
      }
      const cycleParticles = visibleParticlesByCycle.get(cycleNum);
      if (cycleParticles) {
        cycleParticles.push(...visibleBubbleParticles);
      }
    });
    
    // Now process each cycle's particles
    for (const [cycleNum, cycleParticles] of visibleParticlesByCycle.entries()) {
      // Skip cycles with too few particles
      if (cycleParticles.length <= 2) continue;
      
      // Group particles by velocity direction
      const directionGroups: Particle[][] = [];
      const DIRECTION_THRESHOLD = Math.cos(Math.PI/5);  // ~36 degrees threshold
      
      // Temp array to track which particles have been assigned to groups
      const assignedParticles = new Set<Particle>();
      
      // For each particle, create a new group if it hasn't been assigned yet
      for (const particle of cycleParticles) {
        if (assignedParticles.has(particle)) continue;
        
        // Normalize velocity vector for this particle
        const vel = particle.body.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        
        // Skip particles that are barely moving
        if (speed < 0.1) continue;
        
        const velNorm = { x: vel.x / speed, y: vel.y / speed };
        
        // Start a new group with this particle
        const group: Particle[] = [particle];
        assignedParticles.add(particle);
        
        // Find other particles moving in a similar direction
        for (const otherParticle of cycleParticles) {
          if (assignedParticles.has(otherParticle)) continue;
          
          const otherVel = otherParticle.body.velocity;
          const otherSpeed = Math.sqrt(otherVel.x * otherVel.x + otherVel.y * otherVel.y);
          
          // Skip particles that are barely moving
          if (otherSpeed < 0.1) continue;
          
          const otherVelNorm = { x: otherVel.x / otherSpeed, y: otherVel.y / otherSpeed };
          
          // Calculate dot product to determine similarity in direction
          const dotProduct = velNorm.x * otherVelNorm.x + velNorm.y * otherVelNorm.y;
          
          // If directions are similar (dot product near 1), add to the same group
          if (dotProduct > DIRECTION_THRESHOLD) {
            group.push(otherParticle);
            assignedParticles.add(otherParticle);
          }
        }
        
        // Only add groups with multiple particles
        if (group.length >= 2) {
          // Sort particles within group by x position for left-to-right drawing
          group.sort((a, b) => a.body.position.x - b.body.position.x);
          directionGroups.push(group);
        }
      }
      
      // Store the direction groups for this cycle
      if (directionGroups.length > 0) {
        groupsByCycle.set(cycleNum, directionGroups);
      }
    }
    
    return groupsByCycle;
  }
  
  /**
   * Calculate thickness factor based on y-position (enhanced version)
   * Center (0.5) gets 2.1x, edges (0 or 1) get 0.7x
   */
  private calculateThicknessFactorByPosition(normalizedY: number): number {
    // Make center bubbles thicker (2.1x) than edge bubbles (0.7x)
    // normalizedY is 0-1 where 0 is top and 1 is bottom
    return 0.7 + 1.4 * (1 - Math.abs(normalizedY * 2 - 1));
  }



  setRTL(enabled: boolean) {
    this.isRTL = enabled;
    // No need to modify physics - we'll handle this in the render phase
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  setShowParticles(show: boolean) {
    this.showParticles = show;
    this.drawFrame(0); // Force redraw to see changes immediately
  }

  updateParams(params: AnimationParams) {
    const prevShowOval = this.params.showOval;
    const prevPosition = this.params.ovalPosition;
    const prevEccentricity = this.params.ovalEccentricity;
    
    this.params = params;
    
    // Check if oval-related parameters have changed
    if (prevShowOval !== params.showOval || 
        prevPosition !== params.ovalPosition || 
        prevEccentricity !== params.ovalEccentricity) {
      this.updateOval();
      
      // Only force a redraw when oval parameters change
      if (this.animationFrame === null) {
        // Only manually redraw if animation is not running
        this.drawFrame(0);
      }
    }
    
    // Don't call drawFrame here as it causes performance issues
    // with slider interactions by forcing constant redraws
  }
  
  private updateOval() {
    // If the oval exists, remove it from the world
    if (this.ovalBody) {
      Matter.Composite.remove(this.engine.world, this.ovalBody);
      this.ovalBody = null;
    }
    
    // If oval is not supposed to be shown, we're done
    if (!this.params.showOval) {
      return;
    }
    
    // Otherwise, create a new oval ring based on current parameters
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Calculate dimensions based on canvas size and eccentricity
    // Use a fixed width for the majorAxis (80% of canvas width)
    const majorAxis = width * 0.8; 
    const minorAxis = majorAxis * (1 - this.params.ovalEccentricity * 0.8); // Eccentricity affects minor axis
    
    // Calculate position based on ovalPosition parameter
    const centerX = width * this.params.ovalPosition;
    const centerY = height / 2; // Always centered vertically
    
    // Wall thickness for the ring
    const wallThickness = 3;
    
    // Create a composite for all the small segments that will form our ring
    const newOvalBody = Matter.Composite.create();
    this.ovalBody = newOvalBody;
    
    // Number of segments to create a smooth ring
    const segments = 24;
    
    for (let i = 0; i < segments; i++) {
      // Calculate current angle and next angle
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      
      // Calculate current position on the ellipse
      const x1 = centerX + (majorAxis / 2) * Math.cos(angle);
      const y1 = centerY + (minorAxis / 2) * Math.sin(angle);
      
      // Calculate next position on the ellipse
      const x2 = centerX + (majorAxis / 2) * Math.cos(nextAngle);
      const y2 = centerY + (minorAxis / 2) * Math.sin(nextAngle);
      
      // Calculate midpoint and length of segment
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const segmentLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      
      // Calculate angle of the segment
      const segmentAngle = Math.atan2(y2 - y1, x2 - x1);
      
      // Create a small rectangle body for this segment
      const segment = Matter.Bodies.rectangle(midX, midY, segmentLength, wallThickness, {
        isStatic: true,
        angle: segmentAngle,
        restitution: 1.0, // Perfect elasticity
        friction: 0,
        frictionAir: 0,
        frictionStatic: 0,
        collisionFilter: {
          category: 0x0002,
          mask: 0x0001, // Only collide with particles
          group: 0
        }
      });
      
      // Add the segment to our composite
      Matter.Composite.add(this.ovalBody, segment);
    }
    
    // Add the entire composite to the world
    Matter.Composite.add(this.engine.world, this.ovalBody);
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
    Matter.World.clear(this.engine.world, false);
  }

  private drawFrame(progress: number) {
    // Define width and height variables that can be used throughout this method
    const width = this.canvas.width;
    const height = this.canvas.height

    // Apply RTL transformation if enabled
    this.ctx.save();
    if (this.isRTL) {
      // Flip the canvas horizontally for RTL mode
      this.ctx.scale(-1, 1);
      this.ctx.translate(-width, 0);
    }

    // Reduce motion blur effect to make particles stay visible longer
    this.ctx.fillStyle = 'rgba(26, 26, 26, 0.03)'; // Reduced from 0.06 to 0.03 (another 50% reduction)
    this.ctx.fillRect(0, 0, width, height);

    const timeX = width * progress;

    // Draw sweep line with reduced complexity (two layers instead of three)
    // Batch draw calls for performance
    this.ctx.beginPath();
    
    // Glow/blur effect layer
    this.ctx.moveTo(timeX - 2, 0);
    this.ctx.lineTo(timeX - 2, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    this.ctx.lineWidth = 5;
    this.ctx.stroke();
    
    // Main sweep line - thicker and brighter
    this.ctx.beginPath();
    this.ctx.moveTo(timeX, 0);
    this.ctx.lineTo(timeX, height);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)"; // Increased brightness
    this.ctx.lineWidth = 2; // Thicker line
    this.ctx.stroke();

    // Draw activation line with batched calls
    // Glow layer
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.05)";
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
    
    // Main activation line
    this.ctx.beginPath();
    this.ctx.moveTo(this.activationLineX, 0);
    this.ctx.lineTo(this.activationLineX, height);
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.1)";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Check if the sweep line has crossed the activation line (left to right only)
    const hasPassedActivationLine = 
      (this.previousSweepLineX < this.activationLineX && timeX >= this.activationLineX);

    // Activation line spawning - create blue particles when sweep line crosses activation line
    if (hasPassedActivationLine) {
      const newBubbles = this.generateBubbles(this.activationLineX);
      this.bubbles.push(...newBubbles);
    }

    // Update previous position for next frame
    this.previousSweepLineX = timeX;

    // Limit physics calculations to on-screen elements
    const bufferMargin = 50; // Increased margin to prevent abrupt changes (20px → 50px)
    const screenBounds = {
      min: { x: -bufferMargin, y: -bufferMargin },
      max: { x: this.canvas.width + bufferMargin, y: this.canvas.height + bufferMargin }
    };

    // First pass: Update physics collision filters for all bubbles
    this.bubbles.forEach(bubble => {
      // Optimize physics by only processing particles within or near the canvas
      if (bubble.particles.length > 0) {
        bubble.particles.forEach(particle => {
          const pos = particle.body.position;
          const isOnScreen = 
            pos.x >= screenBounds.min.x && 
            pos.x <= screenBounds.max.x && 
            pos.y >= screenBounds.min.y && 
            pos.y <= screenBounds.max.y;

          // Only process physics for on-screen particles
          if (isOnScreen) {
            // Enable collisions for on-screen particles
            const collisionFilter = {
              category: 0x0001,
              mask: 0x0002, // Only collide with the oval (0x0002), not other particles
              group: 0 // Using standard group to rely on mask
            };
            Matter.Body.set(particle.body, 'collisionFilter', collisionFilter);
            // Keep normal physics simulation for on-screen particles
            Matter.Body.setStatic(particle.body, false);
          } else {
            // Disable collisions for off-screen particles to save computation
            const collisionFilter = {
              category: 0x0000,
              mask: 0x0000, // Don't collide with anything
              group: 0 // Don't allow collision with other particles
            };
            Matter.Body.set(particle.body, 'collisionFilter', collisionFilter);
            // Make off-screen particles static to further reduce computation
            Matter.Body.setStatic(particle.body, true);
          }
        });
      }
    });

    // Second pass: Group particles by cycle and direction
    // This is a significant change from the previous implementation
    // as it groups particles across bubbles based on cycle number
    const cycleGroups = this.groupParticlesByCycleAndDirection();
    
    // Draw each cycle's particle groups
    // Using Array.from to avoid the TypeScript error about MapIterator
    Array.from(cycleGroups.entries()).forEach(([cycleNum, directionGroups]) => {
      // Calculate the age of this cycle to determine brightness
      const cycleDiff = this.currentCycleNumber - cycleNum;
      const cycleFactor = Math.max(0, 1 - cycleDiff / CanvasController.PARTICLE_LIFETIME_CYCLES);
      
      // Calculate common drawing parameters once per cycle
      const baseOpacity = cycleFactor * 0.8; // Decay opacity as cycle gets older
      const drawPowerFactor = this.params.power / 3;
      
      // Process each direction group for this cycle
      for (const particleGroup of directionGroups) {
        if (particleGroup.length < 3) continue; // Skip groups with too few particles
        
        // Calculate the average y-position to determine the proper thickness
        const avgY = particleGroup.reduce((sum, p) => sum + p.body.position.y, 0) / particleGroup.length;
        const normalizedY = avgY / this.canvas.height; // 0-1 position
        
        // Calculate thickness based on y-position (center thicker than edges)
        // Center (0.5) gets 2.1x, edges (0 or 1) get 0.7x
        const thicknessFactor = 0.7 + 1.4 * (1 - Math.abs(normalizedY * 2 - 1));
        
        // Draw a glow effect with reduced blur layers
        for (let blur = 3; blur >= 0; blur--) {
          this.ctx.beginPath();
          const currentOpacity = baseOpacity * (1 - blur * 0.2); // Fade out each blur layer
          
          // Only use shadow effect for higher power levels to save rendering time
          if (this.params.power > 1) {
            this.ctx.shadowColor = 'rgba(0, 220, 255, 0.5)';
            this.ctx.shadowBlur = 8 * drawPowerFactor;
          } else {
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
          }
          
          // Use a slightly different blue hue for each direction group for visual distinction
          // This creates a subtle rainbow effect across different wave fronts
          const hueShift = (particleGroup[0].groupId % 5) * 10; // Vary hue slightly based on group
          this.ctx.strokeStyle = `rgba(${20 + hueShift}, ${210 - hueShift/2}, 255, ${currentOpacity})`;
          
          // Apply power, cycle age and position-based thickness to stroke width
          this.ctx.lineWidth = baseOpacity * thicknessFactor * this.params.power * 3.5;
          
          // Start at the first particle in this group
          const startPos = particleGroup[0].body.position;
          this.ctx.moveTo(startPos.x, startPos.y);
          
          // Use quadratic bezier curves to connect particles in this group
          for (let i = 0; i < particleGroup.length - 1; i++) {
            const p1 = particleGroup[i].body.position;
            const p2 = particleGroup[i+1].body.position;
            
            // Adaptive control factor based on distance between points
            // Larger distances need smaller factors to avoid wild curves
            const distance = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
            const adaptiveControlFactor = Math.min(0.35, 25 / distance);
            
            // Calculate midpoint between the points
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            
            // Calculate perpendicular vector to create natural curve
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            
            // Create control point by offsetting from midpoint in perpendicular direction
            const cpx = midX - dy * adaptiveControlFactor;
            const cpy = midY + dx * adaptiveControlFactor;
            
            // Draw the quadratic bezier curve (single control point)
            this.ctx.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
          }
          
          this.ctx.stroke();
        }
      }
      
      // Reset shadow effects after drawing all groups for this cycle
      this.ctx.shadowColor = 'transparent';
      this.ctx.shadowBlur = 0;
    });
    
    // Draw individual particles that weren't grouped
    if (this.showParticles) {
      this.bubbles.forEach(bubble => {
        if (bubble.energy <= 0) return;
        
        // Find particles that aren't part of any direction group
        const visibleParticles = bubble.particles.filter(p => {
          const pos = p.body.position;
          return pos.x >= 0 && pos.x <= this.canvas.width && pos.y >= 0 && pos.y <= this.canvas.height;
        });
        
        if (visibleParticles.length > 0) {
          const cycleDiff = this.currentCycleNumber - bubble.cycleNumber;
          const opacity = bubble.energy / bubble.initialEnergy;
          
          visibleParticles.forEach((particle: Particle) => {
            const pos = particle.body.position;
            const particleSize = (cycleDiff / CanvasController.PARTICLE_LIFETIME_CYCLES) * 0.4;
            
            // Draw a filled circle with neon pink glow effect
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, particleSize * 0.8, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 50, 200, ${opacity * 0.6})`; // Neon pink, decays
            this.ctx.fill();
          });
        }
      });
    }

    // Update the bubbles array by filtering out expired bubbles
    this.bubbles = this.bubbles.filter(bubble => {
      if (this.currentCycleNumber - bubble.cycleNumber > CanvasController.PARTICLE_LIFETIME_CYCLES) {
        if (bubble.particles.length > 0) {
          bubble.particles.forEach(particle => {
            Matter.Composite.remove(this.engine.world, particle.body);
          });
        }
        return false;
      }
      return true;
    });

    // Draw the oval if it exists and is supposed to be shown
    if (this.params.showOval && this.ovalBody) {
      // Since the oval is now a composite of multiple segments,
      // we need to iterate through each body in the composite
      const bodies = Matter.Composite.allBodies(this.ovalBody);
      
      // Draw a glow effect for all the segments that make up the oval
      this.ctx.beginPath();
      
      // Iterate through each segment body and draw it
      bodies.forEach(body => {
        const vertices = body.vertices;
        
        this.ctx.moveTo(vertices[0].x, vertices[0].y);
        
        for (let i = 1; i < vertices.length; i++) {
          this.ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        
        // Close the path for this segment
        this.ctx.lineTo(vertices[0].x, vertices[0].y);
      });
      
      // Add a subtle glow
      this.ctx.shadowColor = 'rgba(220, 50, 255, 0.5)';
      this.ctx.shadowBlur = 10;
      this.ctx.strokeStyle = 'rgba(220, 50, 255, 0.3)';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
      
      // Reset shadow for the next drawing
      this.ctx.shadowColor = 'transparent';
      this.ctx.shadowBlur = 0;
    }
    
    // Restore canvas state (important for RTL transformation)
    this.ctx.restore();
  }

  private animate() {
    if (!this.startTime) return;

    // Calculate time elapsed since last frame
    const elapsed = performance.now() - this.startTime;
    const cyclePeriod = CanvasController.CYCLE_PERIOD_MS;
    const currentCycleTime = Math.floor(elapsed / cyclePeriod);

    // Incrament Cycles
    if (currentCycleTime > this.lastCycleTime) {
      this.lastCycleTime = currentCycleTime;
      this.currentCycleNumber++;
      console.log(`Starting cycle ${this.currentCycleNumber}`);

      // Kill bubbles and their particles if they're too old

      // Remove particles from physics engine that are no longer in any bubble
      const activeBodies = new Set(this.bubbles.flatMap(b => b.particles.map(p => p.body)));
      Matter.Composite.allBodies(this.engine.world).forEach(body => {
        // Skip walls and other static bodies
        if (body.isStatic) return;

        // If the body is not in active bubbles, remove it from the world
        if (!activeBodies.has(body)) {
          Matter.Composite.remove(this.engine.world, body);
        }
      });

      // Call the cycle start callback if it exists
      if (this.onCycleStart) {
        this.onCycleStart();
      }
    }

    // Get normalized progress through current cycle (0 to 1)
    const progress = (elapsed % cyclePeriod) / cyclePeriod;
    this.updatePhysics(elapsed);
    this.drawFrame(progress);
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  private updatePhysics(timestamp: number) {
    // Use a variable number of substeps based on whether oval is shown
    // More steps for better collision accuracy when oval is present
    // Fewer steps when no complex collisions are needed
    const numSubSteps = this.params.showOval ? 4 : 2; // Reduced from 6 to 4 when oval shown, 2 when not
    const subStepTime = CanvasController.PHYSICS_TIMESTEP_MS / numSubSteps;
    
    for (let i = 0; i < numSubSteps; i++) {
      Matter.Engine.update(this.engine, subStepTime);
    }

    // Update bubble energies
    this.bubbles.forEach(bubble => this.updateBubbleEnergy(bubble));
  }
}
