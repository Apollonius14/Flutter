import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, Pause, Languages } from "lucide-react";
import { CanvasController } from "@/lib/canvas-controller";
import { Switch } from "@/components/ui/switch";

const translations = {
  en: {
    title: "Air Flow Visualizer",
    pulseIntensity: "Pulse Intensity (0-1)",
    coherence: "Coherence (0-5)",
    startTime: "Start Time (0-100ms)",
    endTime: "End Time (0-100ms)",
    play: "Play",
    pause: "Pause",
    showFunnel: "Show Funnel"
  },
  ar: {
    title: "محاكاة تدفق الهواء",
    pulseIntensity: "شدة النبض (٠-١)",
    coherence: "التماسك (٠-٥)",
    startTime: "وقت البدء (٠-١٠٠ م.ث)",
    endTime: "وقت النهاية (٠-١٠٠ م.ث)",
    play: "تشغيل",
    pause: "إيقاف",
    showFunnel: "إظهار القمع"
  }
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<CanvasController | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const t = translations[language];
  const [params, setParams] = useState({
    coherence: 2.5,
    startTime: 0,
    endTime: 100,
    pulseIntensity: 0,
  });
  const [funnelEnabled, setFunnelEnabled] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      const newController = new CanvasController(canvasRef.current);
      setController(newController);
      return () => newController.cleanup();
    } catch (error) {
      console.error("Failed to initialize canvas controller:", error);
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

  useEffect(() => {
    if (!controller) return;
    controller.setFunnelEnabled(funnelEnabled);
  }, [funnelEnabled, controller]);

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
                  {t.pulseIntensity}
                </Label>
                <Slider
                  value={[params.pulseIntensity]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, pulseIntensity: value }))
                  }
                  className="pt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.coherence}
                </Label>
                <Slider
                  value={[params.coherence]}
                  min={0}
                  max={5}
                  step={0.1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, coherence: value }))
                  }
                  className="pt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.startTime}
                </Label>
                <Slider
                  value={[params.startTime]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, startTime: value }))
                  }
                  className="pt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className={`text-gray-200 ${language === 'ar' ? 'arabic block text-right' : ''}`}>
                  {t.endTime}
                </Label>
                <Slider
                  value={[params.endTime]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, endTime: value }))
                  }
                  className="pt-2"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className={`text-gray-200 ${language === 'ar' ? 'arabic' : ''}`}>
                    {t.showFunnel}
                  </Label>
                  <Switch
                    checked={funnelEnabled}
                    onCheckedChange={setFunnelEnabled}
                  />
                </div>
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
          <CardContent className="p-6">
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