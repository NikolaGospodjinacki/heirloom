import * as THREE from 'three';
import { Sprite } from './sprite';
import { drawHero } from '../render/draw';
import { swingPiece } from '../render/look';
import { rankDef } from '../game/ranks';
import type { Member } from '../net/party';

/** Your friends, drawn exactly the way your own hero is, wherever they stand in your scene. */
export class RemotesView {
  private sprites = new Map<string, Sprite>();
  private parent: THREE.Object3D;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  sync(members: Member[], scene: string, zoneKey: string, lean: number): void {
    const seen = new Set<string>();
    const now = performance.now();
    for (const mem of members) {
      const s = mem.state;
      if (!s || s.sc !== scene || (scene === 'zone' && s.zk !== zoneKey)) continue;
      if (now - mem.seen > 6000) continue;
      seen.add(mem.id);
      let sp = this.sprites.get(mem.id);
      if (!sp) {
        sp = new Sprite(124, 128, { res: 3, footPad: 10, xray: true });
        this.sprites.set(mem.id, sp);
        this.parent.add(sp.mesh);
      }
      sp.mesh.visible = true;
      const p = mem.profile;
      sp.paint(mem.rx, mem.ry, (c) => drawHero(c, mem.rx, mem.ry, p.appearance, s.f, s.w, {
        gear: swingPiece(p.look, !!s.hv), swing: s.sw, swingMax: s.sm || 0.2, hurt: s.hu,
        iframes: s.ifr, shield: !!s.sh, spin: !!s.sp, rank: p.rank, rankColor: rankDef(p.rank).color,
        downed: !!s.dn,
      }));
      sp.place(mem.rx, mem.ry, mem.rz, lean);
    }
    for (const [id, sp] of this.sprites) if (!seen.has(id)) sp.mesh.visible = false;
  }

  clear(): void {
    for (const sp of this.sprites.values()) {
      this.parent.remove(sp.mesh);
      sp.dispose();
    }
    this.sprites.clear();
  }
}
