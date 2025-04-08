#!/bin/bash
# Optimized Vite Build Script for production 
# This script configures build optimization settings via environment variables 
# that Vite will pick up, avoiding the need to modify vite.config.ts

echo "Starting optimized production build..."

# Set optimization-related environment variables 
export VITE_BUILD_TARGET=esnext
export VITE_BUILD_MINIFY=esbuild 
export VITE_BUILD_SOURCEMAP=false
export NODE_ENV=production

# Clear the dist directory
echo "Cleaning previous build..."
rm -rf dist

# Run the build command with optimized settings
echo "Running optimized build process..."
npm run build

# Report build size
echo "Build size report:"
du -sh dist
du -sh dist/public

echo "✅ Build complete!"