#!/bin/bash

# This script helps reduce app size by:
# 1. Removing unused packages
# 2. Optimizing imports for lucide-react icons

echo "Starting app size optimization..."

# 1. Make sure we have the latest package.json
npm install glob fs-extra --no-save

# 2. Remove react-icons completely as it's not used
echo "Removing unused react-icons package..."
npm uninstall react-icons

# 3. Run the script to update lucide-react imports
echo "Updating lucide-react imports to use individual files..."
node update-icon-imports.js

# 4. Install the optimized dependencies
echo "Reinstalling dependencies with optimized configuration..."
npm install

# 5. Clean up any unused files
echo "Cleaning up..."
rm -rf node_modules/.cache

echo "Optimization complete! App size should be significantly reduced."
echo "To check the new size: du -h -d 1 | sort -hr"