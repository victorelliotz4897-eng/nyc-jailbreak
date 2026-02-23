import { useEffect, useRef } from "react";

export default function SnowCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let animationFrameId;
    let width;
    let height;

    const particles = [];

    function resizeCanvas() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }

    function makeFlake() {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.random() - 0.5,
        vy: Math.random() * 2 + 1,
        size: Math.random() * 3 + 1,
      };
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);

      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.y > height) {
          particle.y = -10;
          particle.x = Math.random() * width;
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    resizeCanvas();
    for (let index = 0; index < 100; index += 1) {
      particles.push(makeFlake());
    }

    animate();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return <canvas id="snow-canvas" ref={canvasRef} aria-hidden="true" />;
}
