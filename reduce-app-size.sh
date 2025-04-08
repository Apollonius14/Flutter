#!/bin/bash

# This script helps reduce app size by:
# 1. Removing unused packages
# 2. Optimizing imports for lucide-react icons

echo "Starting app size optimization..."

# 1. Remove react-icons completely as it's not used
echo "Removing unused react-icons package..."
npm uninstall react-icons

# 2. Install necessary tools for the import update script
echo "Installing necessary tools..."
npm install glob fs-extra --no-save

# 3. Now let's manually create optimized imports for all needed files
echo "Manually updating key component files to use individual imports..."

# Let's manually optimize a few key files to demonstrate the approach
# First, create a backup directory
mkdir -p ./backup-files

# Function to replace imports in a file
optimize_file() {
    local file=$1
    local backup="./backup-files/$(basename $file).bak"
    
    # Create backup
    cp "$file" "$backup"
    
    # Process imports
    sed -i 's/import { \([^}]*\)ChevronDown\([^}]*\) } from "lucide-react"/import ChevronDown from "lucide-react\/dist\/esm\/icons\/chevron-down"/g' "$file"
    sed -i 's/import { \([^}]*\)ChevronLeft\([^}]*\) } from "lucide-react"/import ChevronLeft from "lucide-react\/dist\/esm\/icons\/chevron-left"/g' "$file"
    sed -i 's/import { \([^}]*\)ChevronRight\([^}]*\) } from "lucide-react"/import ChevronRight from "lucide-react\/dist\/esm\/icons\/chevron-right"/g' "$file"
    sed -i 's/import { \([^}]*\)ChevronUp\([^}]*\) } from "lucide-react"/import ChevronUp from "lucide-react\/dist\/esm\/icons\/chevron-up"/g' "$file"
    sed -i 's/import { \([^}]*\)Circle\([^}]*\) } from "lucide-react"/import Circle from "lucide-react\/dist\/esm\/icons\/circle"/g' "$file"
    sed -i 's/import { \([^}]*\)X\([^}]*\) } from "lucide-react"/import X from "lucide-react\/dist\/esm\/icons\/x"/g' "$file"
    sed -i 's/import { \([^}]*\)Search\([^}]*\) } from "lucide-react"/import Search from "lucide-react\/dist\/esm\/icons\/search"/g' "$file"
    
    echo "Optimized $file"
}

# Example optimization for a few files
for file in ./client/src/components/ui/select.tsx ./client/src/components/ui/command.tsx ./client/src/components/ui/dialog.tsx
do
    if [ -f "$file" ]; then
        optimize_file "$file"
    fi
done

# 4. Install the optimized dependencies
echo "Reinstalling dependencies with optimized configuration..."
npm install

# 5. Clean up any unused files
echo "Cleaning up..."
rm -rf node_modules/.cache

echo "Optimization complete! App size should be significantly reduced."
echo "To check the new size: du -h -d 1 | sort -hr"