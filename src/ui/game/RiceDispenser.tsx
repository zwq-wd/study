/**
 * 打饭机 —— 这一版的主体。
 *
 * 画面完全由图片素材组成（不画代码）：
 * - 机器本体：/pet/props/machine.webp（生图后抠掉白底）
 * - 机器里那碗：/pet/props/bowl.webp
 * - 每答对一个词掉一撮饭：/pet/props/scoop.webp
 *
 * 五个词 = 一碗饭，所以进度做得像打饭机的刻度：机器下方五格灯，
 * 亮到第几格就是这碗装到第几勺。装满时整台机器「叮」一下并冒热气。
 */
import type { ReactElement } from "react";

export interface RiceDispenserProps {
  /** 这碗已经装了几勺（0..total） */
  filled: number;
  /** 一共几勺装满 */
  total: number;
  /** 刚刚掉了一勺：驱动掉饭 + 机器抖一下 */
  dropping: boolean;
  /** 刚刚装满：驱动「叮」的结算特效 */
  justDone: boolean;
  /** 当前这碗的 id，换碗时整个碗重新落一次 */
  bowlId: number;
}

export function RiceDispenser({
  filled,
  total,
  dropping,
  justDone,
  bowlId,
}: RiceDispenserProps): ReactElement {
  return (
    <div className="disp" data-drop={dropping ? "1" : "0"} data-done={justDone ? "1" : "0"}>
      <div className="disp-body">
        {/* 机器本体 */}
        <img className="disp-machine" src="/pet/props/machine.webp" alt="" draggable={false} />

        {/* 出饭口的碗：换碗时用 key 重挂，触发落碗动画 */}
        <img
          key={bowlId}
          className="disp-bowl"
          src="/pet/props/bowl.webp"
          alt=""
          draggable={false}
          data-empty={filled === 0 ? "1" : "0"}
        />

        {/* 掉饭：每一勺都重新挂一次，让动画从头播 */}
        {dropping && (
          <img className="disp-drop" src="/pet/props/scoop.webp" alt="" draggable={false} key={`d${filled}`} />
        )}

        {/* 装满时冒的一团热气 */}
        {justDone && <span className="disp-steam" aria-hidden />}
      </div>

      {/* 五格刻度：亮到第几格就是这碗装到第几勺 */}
      <div className="disp-gauge" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="disp-cell" data-on={i < filled ? "1" : "0"} />
        ))}
      </div>
    </div>
  );
}
