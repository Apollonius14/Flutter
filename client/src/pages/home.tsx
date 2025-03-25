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
    frequency: "Spawn Frequency (0-1)",
    power: "Power (1-7)",
    play: "Play",
    pause: "Pause",
    wallCurvature: "Wall Angle (0-90°)",
    gapSize: "Gap Size",
    loading: "Loading Physics Engine..."
  },
  ar: {
    title: "محاكاة تدفق الهواء",
    frequency: "معدل التوليد (٠-١)",
    power: "القوة (١-٧)",
    play: "تشغيل",
    pause: "إيقاف",
    wallCurvature: "زاوية الحائط (٠-٩٠°)",
    gapSize: "حجم الفجوة",
    loading: "جاري تحميل محرك الفيزياء..."
  }
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<CanvasController | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [isLoading, setIsLoading] = useState(true);
  const t = translations[language];
  const [params, setParams] = useState({
    power: 3, // default value of 3 (middle of 1-7 range)
    frequency: 0.15,
  });
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

  useEffect(() => {
    if (!controller) return;
    controller.updateParams(params);
  }, [params, controller]);

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

  const togglePlay = () => setIsPlaying(!isPlaying);
  const toggleLanguage = () => setLanguage(lang => lang === 'en' ? 'ar' : 'en');

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <h1 className={`text-4xl font-bold text-center bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent flex-1 ${language === 'ar' ? 'arabic' : ''}`}>
            {t.title}
          </h1>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleLanguage}
            className="bg-gray-800 hover:bg-gray-700"
          >
            <Languages className="h-4 w-4" />
          </Button>
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-6 space-y-6">
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.frequency}
                </Label>
                <Slider
                  value={[params.frequency]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, frequency: value }))
                  }
                  className="pt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.power}
                </Label>
                <Slider
                  value={[params.power]}
                  min={1}
                  max={7}
                  step={0.5}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, power: value }))
                  }
                  className="pt-2"
                />
              </div>
              
              {/* Wall controls - now always visible */}
              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
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
                  className="pt-2"
                />
              </div>
              
              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.gapSize}
                </Label>
                <Slider
                  value={[gapSize]}
                  min={0.1}
                  max={0.8}
                  step={0.01}
                  onValueChange={([value]) => {
                    setGapSize(value);
                  }}
                  className="pt-2"
                />
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={togglePlay}
                className="w-32 bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white"
              >
                {isPlaying ? (
                  <Pause className="mr-2 h-5 w-5" />
                ) : (
                  <Play className="mr-2 h-5 w-5" />
                )}
                <span className={language === 'ar' ? 'arabic' : ''}>
                  {isPlaying ? t.pause : t.play}
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-6 relative">
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-900/80 rounded-md">
                <Loader className="h-8 w-8 text-blue-500 animate-spin mb-4" />
                <p className={`text-blue-400 font-medium ${language === 'ar' ? 'arabic' : ''}`}>
                  {t.loading}
                </p>
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={800}
              height={200}
              className="w-full h-[200px] border border-gray-800 rounded-md"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}