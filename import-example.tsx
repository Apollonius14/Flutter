// BEFORE OPTIMIZATION
// This style imports the entire lucide-react library (33MB)
import { ChevronDown, ChevronLeft, Circle, Languages, Loader, Waves, GitBranchPlus } from "lucide-react";

function MyComponent() {
  return (
    <div>
      <ChevronDown />
      <ChevronLeft />
      <Circle />
      <Languages />
      <Loader />
      <Waves />
      <GitBranchPlus />
    </div>
  );
}

// AFTER OPTIMIZATION
// This style only imports the specific icons you need
/*
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import Circle from "lucide-react/dist/esm/icons/circle";
import Languages from "lucide-react/dist/esm/icons/languages";
import Loader from "lucide-react/dist/esm/icons/loader";
import Waves from "lucide-react/dist/esm/icons/waves";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";

function MyComponent() {
  return (
    <div>
      <ChevronDown />
      <ChevronLeft />
      <Circle />
      <Languages />
      <Loader />
      <Waves />
      <GitBranchPlus />
    </div>
  );
}
*/