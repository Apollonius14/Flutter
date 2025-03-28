import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { 
  ChevronLeft, 
  ChevronRight, 
  Circle, 
  Languages, 
  Loader, 
  GitBranch, 
  GitBranchPlus 
} from "lucide-react";
import { CanvasController } from "@/lib/canvas-controller";

const translations = {
  en: {
    title: "Air Flow Visualizer",
    power: "Power",
    play: "Play",
    pause: "Pause",
    wallCurvature: "Wall Angle",
    gapSize: "Gap Size",
    loading: "Loading Physics Engine...",
    ltr: "Left to Right",
    rtl: "Right to Left",
    particles: "Particles",
    curveLogic: "Curve Logic",
    byBubble: "By Bubble",
    byDirection: "By Direction",
    showDots: "Show Dots"
  },
  ar: {
    title: "محاكاة تدفق الهواء",
    power: "القوة",
    play: "تشغيل",
    pause: "إيقاف",
    wallCurvature: "زاوية الحائط",
    gapSize: "حجم الفجوة",
    loading: "جاري تحميل محرك الفيزياء...",
    ltr: "من اليسار إلى اليمين",
    rtl: "من اليمين إلى اليسار",
    particles: "الجسيمات",
    curveLogic: "منطق المنحنى",
    byBubble: "حسب الفقاعة",
    byDirection: "حسب الاتجاه",
    showDots: "عرض النقاط"
  }
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<CanvasController | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [isLoading, setIsLoading] = useState(true);
  const [isRTL, setIsRTL] = useState(false);
  const [showParticles, setShowParticles] = useState(true);
  const [curveLogic, setCurveLogic] = useState<'ByBubble' | 'ByDirection'>('ByBubble');
  const t = translations[language];
  const [powerValue, setPowerValue] = useState(3); // default value of 3 (middle of 1-7 range)
  // Using a fixed frequency value of 0.15 since we're removing the frequency slider
  // Walls are now always enabled (no need for a state)
  const [wallAngle, setWallAngle] = useState(30); // Start with a slight angle
  const [gapSize, setGapSize] = useState(0.4);

  // Initialize physics engine when the component is mounted
  useEffect(() => {
    console.log('Starting physics engine initialization');
    
    if (!canvasRef.current) {
      console.error('Canvas ref not available yet');
      return;
    }
    
    try {
      console.time('Physics Engine Initialization');
      console.log('Creating new CanvasController instance');
      const newController = new CanvasController(canvasRef.current);
      console.timeEnd('Physics Engine Initialization');
      console.log('Setting controller and turning off loading state');
      setController(newController);
      setIsLoading(false);
      
      // Cleanup function for when component unmounts
      return () => {
        console.log('Cleaning up physics engine');
        newController.cleanup();
      };
    } catch (error) {
      console.error("Failed to initialize canvas controller:", error);
      console.log('Error details:', error);
      setIsLoading(false);
    }
  }, []);

  // Track if a cycle has started to update power only at cycle start
  const [cycleStarted, setCycleStarted] = useState(false);
  const lastPowerValue = useRef(powerValue);

  // Effect to update power value, but only at the beginning of a cycle
  useEffect(() => {
    if (!controller) return;
    
    if (!cycleStarted && isPlaying) {
      // When animation starts playing, update with the current power value
      controller.updateParams({
        power: powerValue,
        frequency: 0.15 // Fixed frequency value
      });
      lastPowerValue.current = powerValue;
      setCycleStarted(true);
    } else if (!isPlaying) {
      // Reset cycle tracking when paused
      setCycleStarted(false);
    }
  }, [controller, powerValue, isPlaying, cycleStarted]);
  
  // Add a listener to know when a cycle starts
  useEffect(() => {
    if (!controller) return;
    
    const handleCycleStart = () => {
      // Only update if power value has changed since last cycle
      if (lastPowerValue.current !== powerValue) {
        controller.updateParams({
          power: powerValue,
          frequency: 0.15 // Fixed frequency value
        });
        lastPowerValue.current = powerValue;
      }
    };
    
    // Add cycle start event listener
    controller.onCycleStart = handleCycleStart;
    
    return () => {
      // Clean up event listener
      if (controller) {
        controller.onCycleStart = null;
      }
    };
  }, [controller, powerValue]);

  useEffect(() => {
    if (!controller) return;
    if (isPlaying) {
      controller.play();
    } else {
      controller.pause();
    }
  }, [isPlaying, controller]);

  // Removed funnelEnabled effect since it's always true now
  
  useEffect(() => {
    if (!controller) return;
    controller.setWallCurvature(wallAngle);
  }, [wallAngle, controller]);
  
  useEffect(() => {
    if (!controller) return;
    controller.setGapSize(gapSize);
  }, [gapSize, controller]);

  useEffect(() => {
    if (!controller) return;
    // Always maintain funnelEnabled as true
    controller.setFunnelEnabled(true);
  }, [controller]);
  
  useEffect(() => {
    if (!controller) return;
    controller.setRTL(isRTL);
  }, [isRTL, controller]);
  
  useEffect(() => {
    if (!controller) return;
    controller.setShowParticles(showParticles);
  }, [showParticles, controller]);
  
  useEffect(() => {
    if (!controller) return;
    controller.setCurveLogic(curveLogic);
  }, [curveLogic, controller]);

  const togglePlay = () => setIsPlaying(!isPlaying);
  const toggleLanguage = () => setLanguage(lang => lang === 'en' ? 'ar' : 'en');
  const toggleRTL = () => setIsRTL(prev => !prev);
  const toggleShowParticles = () => setShowParticles(prev => !prev);
  const toggleCurveLogic = () => setCurveLogic(logic => logic === 'ByBubble' ? 'ByDirection' : 'ByBubble');

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className={`text-3xl font-bold text-center bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent flex-1 ${language === 'ar' ? 'arabic' : ''}`}>
            {t.title}
          </h1>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleLanguage}
            className="bg-gray-800 hover:bg-gray-700"
          >
            <Languages className="h-3 w-3" />
          </Button>
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 space-y-4">
            <div className="grid gap-4">
              {/* Sliders with label and control on the same line */}
              <div className="flex items-center gap-4">
                <Label className={`text-gray-200 w-1/5 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                  {t.power}
                </Label>
                <Slider
                  value={[powerValue]}
                  min={1}
                  max={7}
                  step={0.5}
                  onValueChange={([value]) => setPowerValue(value)}
                  className="flex-1"
                />
              </div>
              
              <div className="flex items-center gap-4">
                <Label className={`text-gray-200 w-1/5 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                  {t.wallCurvature}
                </Label>
                <Slider
                  value={[wallAngle]}
                  min={0}
                  max={90}
                  step={1}
                  onValueChange={([value]) => {
                    setWallAngle(value);
                  }}
                  className="flex-1"
                />
              </div>
              
              <div className="flex items-center gap-4">
                <Label className={`text-gray-200 w-1/5 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                  {t.gapSize}
                </Label>
                <Slider
                  value={[gapSize]}
                  min={0.01}
                  max={0.8}
                  step={0.01}
                  onValueChange={([value]) => {
                    setGapSize(value);
                  }}
                  className="flex-1"
                />
              </div>
              
              {/* Curve Logic control with label */}
              <div className="flex items-center gap-4">
                <Label className={`text-gray-200 w-1/5 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                  {t.curveLogic}
                </Label>
                <div className="flex-1 flex items-center">
                  <div className="flex gap-2 border border-gray-700 rounded-md p-1">
                    <Button
                      size="sm"
                      variant={curveLogic === 'ByBubble' ? "default" : "outline"}
                      onClick={() => setCurveLogic('ByBubble')}
                      className={`flex-1 ${curveLogic === 'ByBubble' ? 'bg-green-600 text-white' : 'text-gray-400'}`}
                    >
                      <GitBranch className="h-4 w-4 mr-1" />
                      {t.byBubble}
                    </Button>
                    <Button
                      size="sm"
                      variant={curveLogic === 'ByDirection' ? "default" : "outline"}
                      onClick={() => setCurveLogic('ByDirection')}
                      className={`flex-1 ${curveLogic === 'ByDirection' ? 'bg-green-600 text-white' : 'text-gray-400'}`}
                    >
                      <GitBranchPlus className="h-4 w-4 mr-1" />
                      {t.byDirection}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Direction and particles controls in a row */}
              <div className="flex justify-center items-center gap-4">
                <Button
                  size="sm"
                  variant={!isPlaying || !isRTL ? "outline" : "default"}
                  onClick={() => {
                    if (!isRTL) {
                      setIsRTL(true);
                    }
                    if (!isPlaying) {
                      setIsPlaying(true);
                    } else if (isRTL) {
                      setIsPlaying(false);
                    }
                  }}
                  className={`border-gray-600 ${!isPlaying || !isRTL ? 'text-gray-400' : 'bg-blue-600 text-white'}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Button
                  size="sm"
                  variant={!isPlaying || isRTL ? "outline" : "default"}
                  onClick={() => {
                    if (isRTL) {
                      setIsRTL(false);
                    }
                    if (!isPlaying) {
                      setIsPlaying(true);
                    } else if (!isRTL) {
                      setIsPlaying(false);
                    }
                  }}
                  className={`border-gray-600 ${!isPlaying || isRTL ? 'text-gray-400' : 'bg-blue-600 text-white'}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant={showParticles ? "default" : "outline"}
                    onClick={toggleShowParticles}
                    className={`border-gray-600 rounded-full ${showParticles ? 'bg-pink-500 text-white' : 'text-gray-400'}`}
                    title={showParticles ? "Hide particle dots" : "Show particle dots"}
                  >
                    <Circle className="h-4 w-4" fill={showParticles ? "#FFF" : "none"} />
                  </Button>
                  <span className="text-xs text-gray-400">
                    {t.showDots}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 relative">
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-900/80 rounded-md">
                <Loader className="h-6 w-6 text-blue-500 animate-spin mb-2" />
                <p className={`text-blue-400 font-medium text-sm ${language === 'ar' ? 'arabic' : ''}`}>
                  {t.loading}
                </p>
              </div>
            )}
            {/* Increased canvas height by 30% from 200 to 260 */}
            <canvas
              ref={canvasRef}
              width={800}
              height={260}
              className="w-full h-[260px] border border-gray-800 rounded-md"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}