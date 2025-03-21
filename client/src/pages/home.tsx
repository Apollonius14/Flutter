import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, Pause } from "lucide-react";
import { CanvasController } from "@/lib/canvas-controller";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<CanvasController | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [params, setParams] = useState({
    turbulence: 2.5,
    coherence: 2.5,
    startTime: 0,
    endTime: 100,
    peakPower: 5,
    pulseIntensity: 0,
  });

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

  const togglePlay = () => setIsPlaying(!isPlaying);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold text-center bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          Air Flow Visualizer
        </h1>

        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label>Pulse Intensity (0-1)</Label>
                <Slider
                  value={[params.pulseIntensity]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, pulseIntensity: value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Turbulence (0-5)</Label>
                <Slider
                  value={[params.turbulence]}
                  min={0}
                  max={5}
                  step={0.1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, turbulence: value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Coherence (0-5)</Label>
                <Slider
                  value={[params.coherence]}
                  min={0}
                  max={5}
                  step={0.1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, coherence: value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Start Time (0-100ms)</Label>
                <Slider
                  value={[params.startTime]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, startTime: value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>End Time (0-100ms)</Label>
                <Slider
                  value={[params.endTime]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, endTime: value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Peak Power (1-10)</Label>
                <Slider
                  value={[params.peakPower]}
                  min={1}
                  max={10}
                  step={0.1}
                  onValueChange={([value]) =>
                    setParams((p) => ({ ...p, peakPower: value }))
                  }
                />
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={togglePlay}
                className="w-32 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              >
                {isPlaying ? (
                  <Pause className="mr-2 h-5 w-5" />
                ) : (
                  <Play className="mr-2 h-5 w-5" />
                )}
                {isPlaying ? "Pause" : "Play"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <canvas
              ref={canvasRef}
              width={800}
              height={200}
              className="w-full h-[200px] border border-border rounded-md bg-white"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}