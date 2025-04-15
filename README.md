**What this is:** Interactive visualisation of how we manipulate sound waves in the mouth to say letters.

**Goal** is to create set-piece animations of how Arabic plosives, fricatives, vowels and trills are created.

**How**

Uses matter.js to simulate elastic particles spreading in circles along a line. Timing is synchronised to give the appearance of a wave front. 

A static, but reshapable boundary represents the mouth. Its eccentricity, position and opening can be varied.

Various shading, interpolation and colour schemes to visualise superposition, amplification, modulation and resonators.

All parameters are configurable - frequency of generating particles, their speed, attenuation by walls, how long they live, the size and shape of the oval. 

**Next**

Fine tune dimensions and dynamics to mouth / speed of sound realitities

Add mechanism to split the oval cavity (mouth and nasal) as well as compress it (tongue)

Consider performance (N^2 complexity as a function of particles) versus fidelity and realism
