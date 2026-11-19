/**
 * 肥鱼本体 —— 直接用桌宠导出的透明 webm，不再用代码画。
 *
 * 素材来自 D:\dsh-pet-standalone-webm-chat（角色 OC「溟月」，仅个人非商业使用，
 * 见 public/pet/NOTICE.md）。每段都是 640x360 / 24fps / VP9-alpha 的透明视频，
 * 角色只占中间一小块（实测包围盒 x 207..429, y 60..332），其余全是透明留白。
 *
 * 所以这里用一个「带固定宽高比的外框 + 放大并负位移的视频」把留白裁掉：
 * 外框由 CSS 按台面高度伸缩，视频按百分比定位，换片不跳位、也不写死像素。
 */
import { useEffect, useRef, useState } from "react";

/** 原片尺寸 */
const FRAME_W = 640;
const FRAME_H = 360;
/** 角色在原片里的包围盒（四段动画取并集） */
const BODY = { left: 207, top: 60, right: 429, bottom: 332 };
const BODY_W = BODY.right - BODY.left;
const BODY_H = BODY.bottom - BODY.top;

/** 外框宽高比，给 CSS 用 */
export const FISH_ASPECT = `${BODY_W} / ${BODY_H}`;

/**
 * 视频相对外框的百分比定位。
 * 放大倍数 = FRAME_W / BODY_W，位移把包围盒左上角对齐到外框原点。
 */
const VIDEO_STYLE: React.CSSProperties = {
  position: "absolute",
  width: `${(FRAME_W / BODY_W) * 100}%`,
  height: `${(FRAME_H / BODY_H) * 100}%`,
  left: `${-(BODY.left / BODY_W) * 100}%`,
  top: `${-(BODY.top / BODY_H) * 100}%`,
  maxWidth: "none",
};

export type FishMood = "idle" | "eating" | "happy" | "hungry" | "troubled";

const CLIPS: Record<FishMood, string> = {
  idle: "/pet/idle.webm",
  eating: "/pet/eating.webm",
  happy: "/pet/happy.webm",
  hungry: "/pet/hungry.webm",
  troubled: "/pet/surprise.webm",
};

export interface FatFishProps {
  mood: FishMood;
  className?: string;
}

export function FatFish({ mood, className }: FatFishProps): React.ReactElement {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  // 换片时从头播。先设 currentTime 再 play：直接 seek 到 0 在部分 WebView 上会黑一帧。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {
      /* 自动播放被拦时停在第一帧，不报错 */
    });
  }, [mood]);

  /**
   * 兜底续播。
   *
   * WebView 在窗口最小化、切后台、或首帧还没解码出来时会自己把视频停下来；
   * 静音视频本来就允许自动播放，所以只要能播就接着播，不做任何提示。
   * 用户点一下页面也算一次可信手势，这时补一次 play 最稳。
   */
  useEffect(() => {
    const resume = (): void => {
      const el = ref.current;
      if (el && el.paused) void el.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pointerdown", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pointerdown", resume);
    };
  }, []);

  return (
    <div
      className={["fatfish", className].filter(Boolean).join(" ")}
      data-mood={mood}
      data-ready={ready ? "1" : "0"}
      style={{ aspectRatio: FISH_ASPECT }}
    >
      <video
        ref={ref}
        key={mood}
        style={VIDEO_STYLE}
        src={CLIPS[mood]}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onLoadedData={() => {
          setReady(true);
          const el = ref.current;
          if (el && el.paused) void el.play().catch(() => {});
        }}
      />
    </div>
  );
}