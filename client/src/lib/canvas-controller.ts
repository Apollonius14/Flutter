import Matter from 'matter-js';
import { 
  Particle, 
  Point2D,
  groupParticles,
  calculateCentroid,
  drawQuadraticBezierCurve,
  calculateLineThickness
} from './canvas-utility';

interface AnimationParams {
  power: number;
  frequency: number;
  showOval: boolean;
  ovalPosition: number; 
  ovalEccentricity: number;
  mouthOpening: number;
  showWaves: boolean; 
  showSmooth: boolean;
}

interface Bubble {
  x: number;
  y: number;
  radius: number;
  initialRadius: number;
  particles: Particle[];
  groupId: number;
  cycleNumber: number;
  energy: number;
  initialEnergy: number;
}

interface SegmentGlow {
  intensity: number;
  lastUpdateTime: number;
  segmentId: number;
}

export class CanvasController {
  // Constants
  private static readonly CYCLE_PERIOD_MS: number = 6667 * 0.15;  
  private static readonly PARTICLE_LIFETIME_CYCLES: number = 4;
  private static readonly PHYSICS_TIMESTEP_MS: number = 10; 
  private static readonly ACTIVATION_LINE_POSITION: number = 0.3; 
  private static readonly PARTICLES_PER_RING: number = 70;
  private static readonly PARTICLE_RADIUS: number = 2.0;
  private static readonly FIXED_BUBBLE_RADIUS: number = 4.0; 
  private static readonly PARTICLE_ANGLES: number[] = (() => {
    const particleAngles: number[] = [];
    const particleCount = CanvasController.PARTICLES_PER_RING;
    const halfCount = Math.floor(particleCount / 2);

    // Add center particle at 0°
    particleAngles.push(0);

    // Add symmetric pairs of particles
    for (let i = 1; i <= halfCount; i++) {
      const angle = (i / halfCount) * Math.PI;
      particleAngles.push(angle);
      particleAngles.push(-angle);
    }

    return particleAngles.sort((a, b) => a - b);
  })();

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
  private lastCycleTime: number = 0;
  public onCycleStart: (() => void) | null = null;
  private frameCounter: number = 0;
  private currentGroupId: number = 0;
  private currentCycleNumber: number = 0;
  private positions: number[] = []; // Vertical positions for bubbles
  private isRTL: boolean = false;
  private showParticles: boolean = true;
  private ovalBody: Matter.Composite | null = null;
  private segmentGlows: SegmentGlow[] = [];
  
  // Temporal anti-aliasing (frame blending) variables
  private prevFrameCanvas: HTMLCanvasElement | null = null;
  private prevFrameCtx: CanvasRenderingContext2D | null = null;
  
  // Templates for particle positions, velocities, and other properties
  
  private bubbleTemplates: {
    position: { x: number; y: number };
    radius: number;
    particles: {
      offsetX: number;
      offsetY: number;
      velocityX: number;
      velocityY: number;
    }[];
  }[] = [];
  
  // Flag to track if templates have been initialized
  private templatesInitialized: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // Apply device pixel ratio for higher resolution rendering
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Set the canvas dimensions based on device pixel ratio
    // Store the CSS dimensions
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    
    // Set the internal canvas dimensions for high resolution
    canvas.width = Math.floor(displayWidth * pixelRatio);
    canvas.height = Math.floor(displayHeight * pixelRatio);
    
    // Update stored dimensions
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
    
    // Scale the context based on the device pixel ratio
    ctx.scale(pixelRatio, pixelRatio);
    
    // Initialize the previous frame canvas for temporal anti-aliasing
    this.prevFrameCanvas = document.createElement('canvas');
    this.prevFrameCanvas.width = canvas.width;
    this.prevFrameCanvas.height = canvas.height;
    this.prevFrameCtx = this.prevFrameCanvas.getContext('2d', { alpha: false });
    if (this.prevFrameCtx) {
      this.prevFrameCtx.scale(pixelRatio, pixelRatio);
    }
    
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      positionIterations: 5,
      velocityIterations: 4,
      constraintIterations: 3
    }); 
    this.params = {
      power: 12,
      frequency: 0.3,
      showOval: false,
      ovalPosition: 0.5,
      ovalEccentricity: 0.6,
      mouthOpening: 0, 
      showWaves: false, 
      showSmooth: false 
    };

    this.activationLineX = displayWidth * CanvasController.ACTIVATION_LINE_POSITION;
    this.canvas.style.backgroundColor = '#1a1a1a';

    // 1. Initialize vertical positions for bubbles
    this.initializePositions();
    
    // 2. Initialize particle templates (pre-calculated positions and velocities) 
    this.initializeParticleTemplates();

    // 3. Initialize oval  
    this.updateOval();
    

    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      // Process collisions when oval is active
      if (this.params.showOval && this.ovalBody) {
        const pairs = event.pairs;
        const now = performance.now(); 
        for (const pair of pairs) {
          // We need to identify which body is the oval segment
          let segment, particleBody;
          
          if (pair.bodyA.collisionFilter.category === 0x0002) {
            segment = pair.bodyA;
            particleBody = pair.bodyB;
          } else if (pair.bodyB.collisionFilter.category === 0x0002) {
            segment = pair.bodyB;
            particleBody = pair.bodyA;
          } else {
            continue; 
          }

          // Find the actual particle object associated with this physics body
          const particleObj = this.findParticleByBody(particleBody);
          if (particleObj) {
            // Increment the collided count to mark this particle as collided
            particleObj.collided += 1;
          }

          const segmentId = segment.id;
          

          const collision = pair.collision;
          const normal = collision ? { x: collision.normal.x, y: collision.normal.y } : { x: 0, y: 0 };
          
          // Get particle velocity
          const velocity = {
            x: this.params.power * particleBody.velocity.x,
            y: particleBody.velocity.y
          };
          
          // Calculate dot product of velocity and normal for collision
          const dotProduct = velocity.x * normal.x + velocity.y * normal.y;
          
          // Take absolute value since we care about magnitude of impact, not direction
          const impactMagnitude = Math.abs(dotProduct)*0.2;
          
          // Apply a threshold to filter out tiny collisions and static noise
          // Ignore collisions that don't meet the minimum threshold
          const COLLISION_THRESHOLD = 0.3;
          if (impactMagnitude < COLLISION_THRESHOLD) {
            continue; // Skip this collision as it's too small
          }
          
          
          // Apply a more aggressive scaling factor for more dramatic effects
          const scaledImpact = Math.pow(impactMagnitude, 3) * this.params.power * 5.0; 
          
          // Normalize to a higher range (0 to 3.0) for more dramatic max effects
          const normalizedIntensity = Math.min(Math.max(0, scaledImpact), 3.0);
          
          // Check if there's already a glow for this segment
          const existingGlowIndex = this.segmentGlows.findIndex(glow => glow.segmentId === segmentId);
          
          if (existingGlowIndex >= 0) {
            // Update existing glow intensity with a higher cap (15.0 instead of 10.0)
            const existingGlow = this.segmentGlows[existingGlowIndex];
            existingGlow.intensity = Math.min(existingGlow.intensity + normalizedIntensity, 15.0);
            existingGlow.lastUpdateTime = now;
          } else {
            // Only create new glow records for significant collisions
            if (normalizedIntensity > COLLISION_THRESHOLD * 2) {
              this.segmentGlows.push({
                segmentId,
                intensity: normalizedIntensity,
                lastUpdateTime: now
              });
            }
          }
        }
      }
    });
  }

  /**
   * Initialize positions for wave patterns
   * Only needs to be called once during initialization
   */
  private initializePositions(): void {
    // Calculate wave positions and store them
    const height = this.canvas.height;
    this.positions = this.calculateWavePositions(height);
    
    console.log("Wave positions initialized with", this.positions.length, "positions");
  }
  
  /**
   * Initializes templates for all bubble and particle positions **/

  private initializeParticleTemplates(): void {
    if (this.templatesInitialized) return;
    
    const x = this.canvas.width * CanvasController.ACTIVATION_LINE_POSITION;
    const height = this.canvas.height;
    const centerY = height / 2;
    const baseRadius = CanvasController.FIXED_BUBBLE_RADIUS;
    
    // Clear any existing templates
    this.bubbleTemplates = [];
    
    // For each wave position, calculate bubble and particle templates
    this.positions.forEach(y => {
      // Calculate bubble radius based on distance from center
      const normalizedPos = (y - centerY) / (height / 2);
      const radiusMultiplier = 2.5 + 4 * Math.cos(normalizedPos * Math.PI);
      const bubbleRadius = baseRadius * radiusMultiplier;
      
      // Create a template for particles in this bubble
      const particleTemplates: {
        offsetX: number;
        offsetY: number;
        velocityX: number;
        velocityY: number;
      }[] = [];
      
      // Calculate positions and velocities for each particle
      const particleAngles = CanvasController.PARTICLE_ANGLES;
      particleAngles.forEach(angle => {
        // Calculate offset from bubble center
        const offsetX = Math.cos(angle) * bubbleRadius;
        const offsetY = Math.sin(angle) * bubbleRadius;
        
        // Calculate initial velocity
        const baseSpeed = 16;
        const velocityX = Math.cos(angle) * baseSpeed * 1.3;
        const velocityY = Math.sin(angle) * baseSpeed * 0.9;
        
        // Store this particle's template
        particleTemplates.push({
          offsetX,
          offsetY,
          velocityX,
          velocityY
        });
      });
      
      // Add this bubble's complete template
      this.bubbleTemplates.push({
        position: { x, y },
        radius: bubbleRadius,
        particles: particleTemplates
      });
    });
    
    this.templatesInitialized = true;
    console.log("Particle templates initialized with", 
      this.bubbleTemplates.length, "bubbles and", 
      this.bubbleTemplates.reduce((total, b) => total + b.particles.length, 0), "particles");
  }

  /**
   * Calculate wave positions across the canvas height
   */
  private calculateWavePositions(canvasHeight: number): number[] {
    const positions: number[] = [];
    const center = canvasHeight / 2;
    const numPositions = 15; 
    const baseSpacing = (canvasHeight * 0.2) / (numPositions + 1);
    const halfSpacing = baseSpacing / 2;

    // Add positions from top to bottom, offset from center
    positions.push(center - halfSpacing - baseSpacing * 3);
    positions.push(center - halfSpacing - baseSpacing * 2.5);
    positions.push(center - halfSpacing - baseSpacing * 2);
    positions.push(center - halfSpacing - baseSpacing * 1.5);
    positions.push(center - halfSpacing - baseSpacing * 1);
    positions.push(center - halfSpacing - baseSpacing * 0.5);
    positions.push(center - halfSpacing - baseSpacing);
    positions.push(center);
    positions.push(center + halfSpacing + baseSpacing);
    positions.push(center + halfSpacing + baseSpacing * 0.5);
    positions.push(center + halfSpacing + baseSpacing * 1);
    positions.push(center + halfSpacing + baseSpacing * 1.5);
    positions.push(center + halfSpacing + baseSpacing * 2);
    positions.push(center + halfSpacing + baseSpacing * 2.5);
    positions.push(center + halfSpacing + baseSpacing * 3);

    return positions;
  }

  /**
   * Spawns new bubbles at the given x-coordinate using pre-calculated templates
   * @param x The x-coordinate where bubbles should be spawned (usually the activation line)
   * @returns Array of newly created Bubble objects
   */
  private spawnBubbles(x: number): Bubble[] {
    // Make sure templates are initialized
    if (!this.templatesInitialized) {
      console.log("Templates not initialized, initializing now...");
      this.initializeParticleTemplates();
    }

    console.log("Spawning bubbles at cycle", this.currentCycleNumber);
    
    const bubbles: Bubble[] = [];
    
    // Spawn bubbles using the pre-calculated templates
    this.bubbleTemplates.forEach(bubbleTemplate => {
      // Generate a unique group ID for this bubble
      const groupId = this.currentGroupId++;
      
      // Create an array to hold the particles for this bubble
      const particles: Particle[] = [];
      
      // Create particles using the templates
      bubbleTemplate.particles.forEach((particleTemplate, idx) => {
        // Calculate absolute position of this particle
        const particleX = x + particleTemplate.offsetX;
        const particleY = bubbleTemplate.position.y + particleTemplate.offsetY;
        
        // Create physics body with consistent properties
        const body = Matter.Bodies.circle(particleX, particleY, CanvasController.PARTICLE_RADIUS, {
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
        
        // Set velocity from the template
        Matter.Body.setVelocity(body, {
          x: particleTemplate.velocityX,
          y: particleTemplate.velocityY
        });
        
        // Add the body to the physics world
        Matter.Composite.add(this.engine.world, body);
        
        // Create the particle object
        const particle: Particle = {
          body,
          groupId,
          cycleNumber: this.currentCycleNumber,
          index: idx,
          energy: this.params.power,
          initialEnergy: this.params.power,
          collided: 0
        };
        
        particles.push(particle);
      });
      
      // Create the bubble with the newly created particles
      bubbles.push({
        x,
        y: bubbleTemplate.position.y,
        radius: bubbleTemplate.radius,
        initialRadius: bubbleTemplate.radius,
        particles,
        groupId,
        cycleNumber: this.currentCycleNumber,
        energy: this.params.power,
        initialEnergy: this.params.power
      });
    });
    
    return bubbles;
  }

  /*  
Updates the energy of individual particles based on their vertical velocity
   */
  
  private findParticleByBody(body: Matter.Body): Particle | undefined {
  
    for (const bubble of this.bubbles) {
      for (const particle of bubble.particles) {
        if (particle.body.id === body.id) {
          return particle;
        }
      }
    }
    return undefined;
  }
  
  private updateBubbleEnergy(bubble: Bubble) {
    // Create a copy of particles for safe iteration while potentially removing some
    const particles = [...bubble.particles];
    let totalEnergy = 0;
    
    // Process each particle's energy
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      const body = particle.body;
      
      // Get the normalized vertical velocity component (absolute value)
      const verticalVelocity = Math.abs(body.velocity.y);
      
      // Calculate decay factor - higher vertical velocity means faster decay
      const velocityFactor = 0.4 + (verticalVelocity * 3.5);
      
      // Apply time-based decay multiplied by the velocity factor
      const decay = particle.initialEnergy * 0.001 * 0.02 * velocityFactor;
      particle.energy = Math.max(0, particle.energy - decay);
      
      // Accumulate energy for bubble total
      totalEnergy += particle.energy;
      
      // If particle energy is zero, remove it from physics and the bubble
      if (particle.energy <= 0) {
        // Mark for removal from the world in the next physics update
        Matter.Composite.remove(this.engine.world, body);
        
        // Remove from the bubble's particles array
        bubble.particles.splice(bubble.particles.indexOf(particle), 1);
      }
    }
    
    // Update bubble's total energy (sum of all its particles)
    bubble.energy = totalEnergy;
  }


  private renderParticle(
    ctx: CanvasRenderingContext2D,
    position: Point2D,
    opacity: number,
    particle?: Particle,
    size: number = CanvasController.PARTICLE_RADIUS * 10
  ): void {
    // If we have a particle with energy data, use that to adjust opacity
    let finalOpacity = opacity * this.params.power * 0.5;
    let particleSize = size;
    
    if (particle) {
      const energyRatio = particle.energy / particle.initialEnergy;
      
      if (particle.collided > 0) {
        finalOpacity = energyRatio; 
      } else {
        finalOpacity = energyRatio * 2.4;
        particleSize = size * 2.0; 
      }
    } else {
      finalOpacity = opacity * 0.5;
    }
  
    ctx.beginPath();
    ctx.arc(position.x, position.y, particleSize, 0, Math.PI * 2);
    
    // Use purple for particles that have collided, cyan for those that haven't
    if (particle && particle.collided > 0) {
      const adjustedOpacity = Math.min(finalOpacity * 0.7, 1.0); // Calculate opacity, ensure it's <= 1.0
      ctx.fillStyle = `rgba(255, 0, 255, ${adjustedOpacity})`;
    } else {
      const adjustedOpacity = Math.min(finalOpacity, 1.0); // Ensure opacity is <= a1.0
      ctx.fillStyle = `rgba(5, 255, 245, ${adjustedOpacity})`;
    }
    
    ctx.fill();
  }
  
  /**
   * Updates glow data for oval segments
   */
  private renderOvalGlow(ctx: CanvasRenderingContext2D, timestamp: number): void {
    if (!this.ovalBody || !this.params.showOval) return;

    const now = timestamp;
    
    this.segmentGlows = this.segmentGlows.filter(glow => {
      const age = (now - glow.lastUpdateTime) / 1000;
      return age < 3; 
    });
  
    // Apply decay to all glows
    for (const glow of this.segmentGlows) {
      const age = (now - glow.lastUpdateTime) / 1000;
      const decayFactor = Math.pow(0.75, age * 2);
      glow.intensity *= decayFactor;
    }
    
    // Remove glows  below threshold
    this.segmentGlows = this.segmentGlows.filter(glow => glow.intensity > 0.05);
  }
  
  /**
   * Draws UI elements like sweep lines and activation lines
   */
  private drawUIElements(width: number, height: number, progress: number): void {
    const ctx = this.ctx;
    
    // Calculate new sweep line position
    const sweepPosition = width * (0.05 + progress * 0.9);
    this.previousSweepLineX = sweepPosition;
    
    // Draw activation line
    ctx.strokeStyle = "#353583";
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    ctx.moveTo(this.activationLineX, 0);
    ctx.lineTo(this.activationLineX, height); 
    ctx.stroke();
    
    // Draw sweep line with a subtle gradient
    const gradient = ctx.createLinearGradient(sweepPosition - 10, 0, sweepPosition + 10, 0);
    gradient.addColorStop(0, "rgba(51, 153, 255, 0)");  
    gradient.addColorStop(0.5, "rgba(51, 153, 255, 0.6)"); 
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    
    ctx.beginPath();  
    ctx.moveTo(sweepPosition, 0);
    ctx.lineTo(sweepPosition, height);
    ctx.stroke();
  }

  
  public setRTL(enabled: boolean) {
    this.isRTL = enabled;
    // Rebuild the oval with the new RTL status
    if (this.params.showOval) {
      this.updateOval();
    }
  }
  
  public setShowParticles(show: boolean) {
    this.showParticles = show;
  }
  
  public setShowWaves(show: boolean) {
    this.params.showWaves = show;
  }
  
  public setShowSmooth(show: boolean) {
    this.params.showSmooth = show;
  }
  
  private renderWaves(ctx: CanvasRenderingContext2D): void {
    // First, collect all particles from all bubbles
    const allParticles: Particle[] = [];
    for (const bubble of this.bubbles) {
      allParticles.push(...bubble.particles);
    }
    
    // Group particles by cycleNumber
    const cycleGroups = groupParticles(allParticles, p => p.cycleNumber);
    
    // Render each cycle's particles
    for (const [, particles] of Array.from(cycleGroups.entries())) {
      // Group by groupId (bubble)
      const bubbleGroups = groupParticles(particles, p => p.groupId);
      
      // Render each bubble's particles as a wave
      for (const [, bubbleParticles] of Array.from(bubbleGroups.entries())) {
        // Sort by index to maintain the same order
        bubbleParticles.sort((a, b) => a.index - b.index);
        
        // Split particles into collided and uncollided 
        const collidedParticles = bubbleParticles.filter(p => p.collided > 0);
        const nonCollidedParticles = bubbleParticles.filter(p => p.collided === 0);
        
        // Draw non-collided (cyan) wave lines first
        if (nonCollidedParticles.length >= 2) {
          ctx.strokeStyle = "rgba(5, 255, 245, 0.6)"; // Light cyan
          ctx.lineWidth = 7.5;
          ctx.beginPath();
          
          let prev: Particle | null = null;
          
          for (const particle of nonCollidedParticles) {
            if (prev) {
              // Only connect if x-distance is not too far
              const dx = Math.abs(particle.body.position.x - prev.body.position.x);
              if (dx < 10) {
                ctx.moveTo(prev.body.position.x, prev.body.position.y);
                ctx.lineTo(particle.body.position.x, particle.body.position.y);
              }
            }
            prev = particle;
          }
          
          ctx.stroke();
        }
        
        // Draw collided (yellow) wave lines
        if (collidedParticles.length >= 2) {
          ctx.strokeStyle = "rgba(255, 0, 255, 0.45)"; 
          ctx.lineWidth = 6
          ctx.beginPath();
          
          let prev: Particle | null = null;
          
          for (const particle of collidedParticles) {
            if (prev) {
              const dx = Math.abs(particle.body.position.x - prev.body.position.x);
              if (dx < 5) { // Threshold to avoid connecting distant particles
                ctx.moveTo(prev.body.position.x, prev.body.position.y);
                ctx.lineTo(particle.body.position.x, particle.body.position.y);
              }
            }
            prev = particle;
          }
          
          ctx.stroke();
        }
      }
    }
  }
  
  
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
  ): void {
    // Increase the number of buckets for finer-grained angle grouping
    // More buckets = more detail in the waves, but requires more particles
    const ANGLE_BUCKETS = 90; // Number of angle buckets (4 degrees each)
    
    // Helper function to group particles by direction angle with cycle-specific buckets
    const groupParticlesByDirection = (particles: Particle[]) => {
      return groupParticles(particles, particle => {
        const velocity = particle.body.velocity;
        const angle = Math.atan2(velocity.y, velocity.x);
        const degrees = ((angle * 180 / Math.PI) + 360) % 360;
        const bucketIndex = Math.floor(degrees / (360 / ANGLE_BUCKETS));
        return bucketIndex.toString();
      });
    };
    
    // First group all particles by cycle number
    const nonCollidedByCycle = groupParticles(nonCollidedParticles, p => p.cycleNumber);
    const collidedByCycle = groupParticles(collidedParticles, p => p.cycleNumber);
    
    // Draw smooth curves for non-collided particles, grouped by cycle
    for (const [, particlesInCycle] of Array.from(nonCollidedByCycle.entries())) {
      if (particlesInCycle.length > 5) { // Need enough particles for meaningful curve
        const buckets = groupParticlesByDirection(particlesInCycle);
        const centroids: Point2D[] = [];
        
        // Extract and sort centroids by angle bucket
        Array.from(buckets.entries())
          .map(([angleBucket, particles]) => ({
            angleBucket: Number(angleBucket),
            centroid: calculateCentroid(particles),
            count: particles.length
          }))
          .filter(item => item.count >= 2) // Only use buckets with multiple particles
          .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
          .forEach(item => centroids.push(item.centroid));
        
        // Draw bezier curve through centroids if we have enough points
        if (centroids.length >= 6) {
          // Calculate line width based on particle count
          const lineWidth = calculateLineThickness(
            particlesInCycle.length,
            3.5,  // Base thickness
            10    // Max thickness
          );
          
          // Draw the curve
          drawQuadraticBezierCurve(
            ctx,
            centroids,
            { strokeStyle: "rgba(254, 0, 254, 1.0)", lineWidth }, // Brilliant cyan
            0.3 // Influence factor (curve smoothness)
          );
        }
      }
    }
    
    // Draw smooth curves for collided particles, grouped by cycle
    for (const [, particlesInCycle] of Array.from(collidedByCycle.entries())) {
      if (particlesInCycle.length > 5) {
        const buckets = groupParticlesByDirection(particlesInCycle);
        const centroids: Point2D[] = [];
        
        // Extract and sort centroids by angle bucket
        Array.from(buckets.entries())
          .map(([angleBucket, particles]) => ({
            angleBucket: Number(angleBucket),
            centroid: calculateCentroid(particles),
            count: particles.length
          }))
          .filter(item => item.count >= 2) // Only use buckets with multiple particles
          .sort((a, b) => a.angleBucket - b.angleBucket) // Sort by angle bucket first
          .forEach(item => centroids.push(item.centroid));
        
        // Draw bezier curve through centroids if we have enough points
        if (centroids.length >= 8) {
          // Calculate line width based on particle count
          const lineWidth = calculateLineThickness(
            particlesInCycle.length,
            2.0,  // Base thickness
            10    // Max thickness
          );
          
          // Draw the curve with slightly higher influence factor for more variation
          drawQuadraticBezierCurve(
            ctx,
            centroids,
            { strokeStyle: "rgba(255, 0, 255, 1.0)", lineWidth }, // Golden yellow
            0.35 // Slightly higher influence factor
          );
        }
      }
    }
  }
  
  public updateParams(params: AnimationParams) {
    const updateOvalNeeded = 
      this.params.showOval !== params.showOval ||
      this.params.ovalPosition !== params.ovalPosition ||
      this.params.ovalEccentricity !== params.ovalEccentricity ||
      this.params.mouthOpening !== params.mouthOpening;
    
    this.params = params;
    
    if (updateOvalNeeded) {
      this.updateOval();
    }
  }
  
  /**
   * Creates a new oval composite
   * Separated from updateOval for better code organization
   */
  private createOvalBody(
    ovalCenterX: number, 
    ovalCenterY: number, 
    ovalWidth: number, 
    ovalHeight: number, 
    mouthOpening: number
  ): Matter.Composite {
    // Create a composite to hold all segment bodies
    const ovalComposite = Matter.Composite.create();
    
    // More segments for smoother oval
    const segments = 59;
    
    // Calculate the oval circumference step angle
    const angleStep = (Math.PI * 2) / segments;
    
    for (let i = 0; i < segments; i++) {
      // Calculate start and end angle of this segment
      const startAngle = i * angleStep;
      const endAngle = startAngle + angleStep;
      
      // Calculate whether this segment should be part of the "mouth" opening
      // The mouth should be symmetrical about the horizontal axis
      
      // Calculate the mouth opening angle based on mouthOpening parameter
      // When mouthOpening is 0, there's no opening
      // When mouthOpening is 1, half of the oval is open (PI radians)
      const mouthWidth = mouthOpening * Math.PI; // up to 180 degrees
      
      // Normalize angle to [0, 2π)
      const midAngle = ((startAngle + endAngle) / 2 + Math.PI * 2) % (Math.PI * 2);
      
      // Determine if this segment is in the mouth region
      let inMouthRegion = false;
      
      if (this.isRTL) {
        // For RTL, the opening is on the left side (π radians)
        // For angles in the left half of the circle, we need the smaller angle to the horizontal
        const angleFromLeftHorizontal = Math.abs(midAngle - Math.PI);
        
        // The mouth should be centered on the left side (π radians) 
        // and symmetrical up and down (from 3π/2 to π/2, going clockwise)
        inMouthRegion = (angleFromLeftHorizontal <= mouthWidth/2) && 
                        // This ensures we're on the left side of the oval
                        (midAngle > Math.PI/2 && midAngle < Math.PI * 3/2);
      } else {
        // For LTR, the opening is on the right side (0 or 2π radians)
        // We need the smaller angle to the horizontal axis
        const angleFromRightHorizontal = (midAngle <= Math.PI) 
                                       ? midAngle 
                                       : 2 * Math.PI - midAngle;
        
        // The mouth should be centered on the right side (0 radians)
        // and symmetrical up and down (from π/2 to 3π/2, going counterclockwise) 
        inMouthRegion = (angleFromRightHorizontal <= mouthWidth/2) && 
                        // This ensures we're on the right side of the oval
                        (midAngle < Math.PI/2 || midAngle > Math.PI * 3/2);
      }
      
      // Skip creating this segment if it's part of the mouth opening
      if (inMouthRegion) {
        continue;
      }
      
      // Calculate vertices of the segment
      const startX = ovalCenterX + Math.cos(startAngle) * ovalWidth;
      const startY = ovalCenterY + Math.sin(startAngle) * ovalHeight;
      const endX = ovalCenterX + Math.cos(endAngle) * ovalWidth;
      const endY = ovalCenterY + Math.sin(endAngle) * ovalHeight;
      
      // Create thickness for the oval wall - offset inward
      const innerScale = 0.9; // 10% smaller for thickness
      const innerStartX = ovalCenterX + Math.cos(startAngle) * ovalWidth * innerScale;
      const innerStartY = ovalCenterY + Math.sin(startAngle) * ovalHeight * innerScale;
      const innerEndX = ovalCenterX + Math.cos(endAngle) * ovalWidth * innerScale;
      const innerEndY = ovalCenterY + Math.sin(endAngle) * ovalHeight * innerScale;
      
      // Create a quad segment using 4 vertices
      const segment = Matter.Bodies.fromVertices(
        (startX + endX + innerStartX + innerEndX) / 4, // center x
        (startY + endY + innerStartY + innerEndY) / 4, // center y
        [[
          { x: startX, y: startY },
          { x: endX, y: endY },
          { x: innerEndX, y: innerEndY },
          { x: innerStartX, y: innerStartY }
        ]],
        {
          isStatic: true, // Oval doesn't move
          friction: 0.0,
          frictionStatic: 0.0,
          frictionAir: 0,
          restitution: 1.0, // perfectly elastic
          slop: 0.005, // reduced from default for precise collisions
          collisionFilter: {
            category: 0x0002, // Oval category
            mask: 0x0001, // Only collide with particles
            group: 0
          }
        }
      );
      
      // Add the segment to the composite
      Matter.Composite.add(ovalComposite, segment);
    }
    
    // Return the complete oval composite
    return ovalComposite;
  }
  
  private updateOval() {
    // If the oval already exists, remove it from the world
    if (this.ovalBody) {
      Matter.Composite.remove(this.engine.world, this.ovalBody);
      this.ovalBody = null;
    }
    
    if (!this.params.showOval) {
      this.engine.timing.timeScale = 1.0; // Reset time scale with no oval
      return;
    }
    
    // Get canvas dimensions
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Calculate oval positioning based on the ovalPosition parameter (0.0 to 1.0)
    // This places the oval horizontally across the canvas with 20% padding on each side
    const ovalCenterX = width * (0.2 + this.params.ovalPosition * 0.6);
    const ovalCenterY = height / 2; // Vertical center
    
    // Calculate oval dimensions - using a size based on canvas height
    const ovalBaseSize = height * 0.4; // 35% of canvas height
    
    // Apply eccentricity - lower values make a more circular oval
    // 0.0 = perfect circle, 1.0 = very elongated horizontal oval
    const eccentricity = this.params.ovalEccentricity;
    const ovalWidth = ovalBaseSize * (1 + eccentricity );
    const ovalHeight = ovalBaseSize * (1 - eccentricity);
    
    // Create the oval composite with the mouth opening parameter
    this.ovalBody = this.createOvalBody(
      ovalCenterX, 
      ovalCenterY, 
      ovalWidth, 
      ovalHeight, 
      this.params.mouthOpening
    );
    
    // Add the oval to the physics world
    Matter.Composite.add(this.engine.world, this.ovalBody);
    
    // When the oval is present, use more substeps for more accurate collision detection
    this.engine.timing.timeScale = 0.5; // Slow down physics by half
  }
  
  public play() {
    if (this.animationFrame !== null) return;
    this.startTime = performance.now();
    this.animate();
  }
  
  public pause() {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
  
  public cleanup() {
    this.pause();
    Matter.Engine.clear(this.engine);
    this.bubbles = [];
    this.segmentGlows = [];
  }
  
  private drawFrame(progress: number) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    
    // Save the current canvas to the previous frame buffer for temporal anti-aliasing
    if (this.prevFrameCtx && this.prevFrameCanvas) {
      // First, copy current main canvas to our buffer
      this.prevFrameCtx.clearRect(0, 0, width, height);
      this.prevFrameCtx.drawImage(this.canvas, 0, 0);
    }
    
    // Clear canvas completely for a fresh frame
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);
    
    // Blend in the previous frame for temporal anti-aliasing
    if (this.prevFrameCtx && this.prevFrameCanvas) {
      // Apply the previous frame with reduced opacity for motion blur effect
      ctx.globalAlpha = 0.30; // Adjust for more/less motion blur (lower = more trails)
      ctx.drawImage(this.prevFrameCanvas, 0, 0);
      ctx.globalAlpha = 1.0; // Reset alpha
    }
    
    // Update glow data for oval segments (data management only)
    this.renderOvalGlow(ctx, performance.now());
  
    // Check if we need to generate bubbles
    // Use progress to ensure bubbles are generated exactly once per cycle
    const cyclePct = progress * 100;
    // Generate bubbles when we're at the activation line (around 30% into the cycle)
    const activationPoint = CanvasController.ACTIVATION_LINE_POSITION * 100;
    const prevCyclePct = ((performance.now() - 16.67) - (this.startTime || 0)) % CanvasController.CYCLE_PERIOD_MS / CanvasController.CYCLE_PERIOD_MS * 100;
    
    // Generate bubbles when crossing the activation point (previous frame was before, current frame is after)
    if (prevCyclePct < activationPoint && cyclePct >= activationPoint) {
      console.log('Spawning bubbles at cycle', this.currentCycleNumber + 1);
      // Spawn new bubbles at the activation line using our templates
      const newBubbles = this.spawnBubbles(this.activationLineX);
      // Add to the list of bubbles
      this.bubbles.push(...newBubbles);
      // Emit cycle started event if callback is registered
      if (this.onCycleStart) this.onCycleStart();
      
      // Update cycle time and cycle number
      this.lastCycleTime = performance.now();
      this.currentCycleNumber++;
    }
    
    // Collect all particles by collision state
    let allParticles: Particle[] = [];
    let collidedParticles: Particle[] = [];
    let nonCollidedParticles: Particle[] = [];
    
    // Update all bubbles and remove fully decayed ones
    this.bubbles = this.bubbles.filter(bubble => {
      // Update energy based on particles
      this.updateBubbleEnergy(bubble);
      
      // Filter empty bubbles
      if (bubble.particles.length === 0) return false;
      
      // Check if too old (by cycle number)
      if (this.currentCycleNumber - bubble.cycleNumber > CanvasController.PARTICLE_LIFETIME_CYCLES) {
        // Remove all physics bodies from the world
        for (const particle of bubble.particles) {
          Matter.Composite.remove(this.engine.world, particle.body);
        }
        return false;
      }
      
      // Collect particles for rendering
      for (const particle of bubble.particles) {
        allParticles.push(particle);
        
        if (particle.collided > 0) {
          collidedParticles.push(particle);
        } else {
          nonCollidedParticles.push(particle);
        }
      }
      
      return true;
    });
    
    // Draw UI elements (sweep lines, etc.)
    this.drawUIElements(width, height, progress);
    
    // Draw oval glow (if needed)
    if (this.params.showOval && this.ovalBody) {
      // Draw each oval segment with a very faint gray fill
      const segments = Matter.Composite.allBodies(this.ovalBody);
      
      // Simple approach: draw each segment with a fill
      for (const segment of segments) {
        // Find if this segment has a glow from collision
        const segmentGlow = this.segmentGlows.find(glow => glow.segmentId === segment.id);
        
        // Get the vertices of the segment
        const verts = segment.vertices;
        
        // Draw the segment with a fill
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        ctx.lineTo(verts[1].x, verts[1].y);
        ctx.lineTo(verts[2].x, verts[2].y);
        ctx.lineTo(verts[3].x, verts[3].y);
        ctx.closePath();
        
        // More noticeable gray fill by default
        let fillOpacity = 0.2; // Slightly more visible default
        let glowColor = "255, 255, 255"; // White glow by default
        
        // If this segment has been hit, increase opacity based on impact intensity
        if (segmentGlow && segmentGlow.intensity > 0) {
          // Decay the glow intensity over time
          const timeElapsed = performance.now() - segmentGlow.lastUpdateTime;
          const decayFactor = Math.max(0, 1 - timeElapsed / 800); // Faster decay for more dynamic effect
          
          // Apply decay to the intensity
          const adjustedIntensity = segmentGlow.intensity * decayFactor;
          
          // Map intensity to opacity (0.2 to 0.8)
          fillOpacity = 0.4 + Math.min(0.4, adjustedIntensity * 0.3);
          
          // Use a bright cyan color for impacted segments
          glowColor = "100, 255, 255";
        }
        
        // Fill with appropriate color and opacity
        // Ensure fillOpacity is a valid CSS rgba value (between 0 and 1)
        const safeOpacity = Math.min(Math.max(0, fillOpacity), 1.0);
        ctx.fillStyle = `rgba(${glowColor}, ${safeOpacity})`;
        ctx.fill();
      }
    }
    
    // Draw wave visualization if enabled
    if (this.params.showWaves) {
      if (this.params.showSmooth) {
        // Draw smoothed curves through particle groups, grouped by cycle
        this.renderSmoothWavesByCycle(ctx, nonCollidedParticles, collidedParticles);
      } else {
        // Draw simpler piecewise linear wave visualization
        this.renderWaves(ctx);
      }
    }
    
    // Draw individual particles if enabled
    if (this.showParticles) {
      for (const particle of allParticles) {
        this.renderParticle(
          ctx, 
          particle.body.position, 
          0.5, // Base opacity
          particle, // Passing particle for energy/color data
          CanvasController.PARTICLE_RADIUS // Base size
        );
      }
    }

    // Track render stats
    this.frameCounter++;
  }
  
  private animate() {
    const currentTime = performance.now();
    if (!this.startTime) this.startTime = currentTime;
    
    const progress = ((currentTime - this.startTime) % CanvasController.CYCLE_PERIOD_MS) / CanvasController.CYCLE_PERIOD_MS;
    
    // Draw the current frame
    this.drawFrame(progress);
    
    // Update physics engine at a fixed timestep
    this.updatePhysics(currentTime);
    
    // Request the next animation frame
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }
  
  private updatePhysics(timestamp: number) {
    // Update using multiple smaller steps for more accurate collision detection
    // Use more substeps when the oval is present (8 vs 4)
    const numSteps = this.params.showOval ? 6 : 3;
    
    // Calculate the timestep size (in seconds)
    const timeStep = CanvasController.PHYSICS_TIMESTEP_MS / 1000 / numSteps;
    
    // Apply multiple smaller steps
    for (let i = 0; i < numSteps; i++) {
      Matter.Engine.update(this.engine, timeStep * 1000, 1.0); // Use second param in ms
    }
  }
}