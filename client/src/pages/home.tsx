import { useEffect, useRef, useState, Suspense, lazy } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, Pause, Languages, Loader } from "lucide-react";
import { CanvasController } from "@/lib/canvas-controller";
import { Switch } from "@/components/ui/switch";

const translations = {
  en: {
    title: "Air Flow Visualizer",
    power: "Power (1-7)",
    play: "Play",
    pause: "Pause",
    wallCurvature: "Wall Angle (0-90°)",
    gapSize: "Gap Size",
    loading: "Loading Physics Engine...",
    rtlMode: "Right-to-Left Mode",
    showParticles: "Show Particles"
  },
  ar: {
    title: "محاكاة تدفق الهواء",
    power: "القوة (١-٧)",
    play: "تشغيل",
    pause: "إيقاف",
    wallCurvature: "زاوية الحائط (٠-٩٠°)",
    gapSize: "حجم الفجوة",
    loading: "جاري تحميل محرك الفيزياء...",
    rtlMode: "وضع اليمين إلى اليسار",
    showParticles: "إظهار الجسيمات"
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

  const togglePlay = () => setIsPlaying(!isPlaying);
  const toggleLanguage = () => setLanguage(lang => lang === 'en' ? 'ar' : 'en');
  const toggleRTL = () => setIsRTL(prev => !prev);
  const toggleShowParticles = () => setShowParticles(prev => !prev);

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
              
              {/* Two toggles on the same line */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-1/2">
                  <Label className={`text-gray-200 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                    {t.rtlMode}
                  </Label>
                  <Switch
                    checked={isRTL}
                    onCheckedChange={toggleRTL}
                    className="data-[state=checked]:bg-blue-500"
                  />
                </div>
                
                <div className="flex items-center gap-2 w-1/2">
                  <Label className={`text-gray-200 text-sm ${language === 'ar' ? 'arabic text-right' : ''}`}>
                    {t.showParticles}
                  </Label>
                  <Switch
                    checked={showParticles}
                    onCheckedChange={toggleShowParticles}
                    className="data-[state=checked]:bg-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                size="sm"
                onClick={togglePlay}
                className="w-24 bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white"
              >
                {isPlaying ? (
                  <Pause className="mr-1 h-3 w-3" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                <span className={`text-sm ${language === 'ar' ? 'arabic' : ''}`}>
                  {isPlaying ? t.pause : t.play}
                </span>
              </Button>
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