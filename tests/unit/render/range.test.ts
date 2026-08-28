// range — the RangeShell handle contract after SESSION-02 of the tactical-attack-
// mock-parity feature. The pre-SESSION-02 shell was a translucent filled
// SphereGeometry; the shipping shell is three orthogonal great-circle LineLoops
// under a Group. These tests are the tripwire against a return to the filled
// bubble that washes over ship glyphs (mocks/tactical-attack.html:381-389 shows
// the mock's thin concentric rings). WebGL rendering itself is a screen-e2e
// concern; here we pin the pure surface: line-only geometry, transparent + no
// depth write, mutators write the root, disposal covers every resource.

import { describe, expect, it } from 'vitest';
import {
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  Object3D,
  SphereGeometry,
} from 'three';
import { createRangeShell } from '../../../src/render/range.js';

const rootChildren = (mesh: Object3D): readonly Object3D[] => mesh.children;

describe('createRangeShell', () => {
  it('returns a Group root scaled to the initial radius', () => {
    const shell = createRangeShell(240);
    try {
      expect(shell.mesh).toBeInstanceOf(Group);
      expect(shell.mesh.scale.x).toBe(240);
      expect(shell.mesh.scale.y).toBe(240);
      expect(shell.mesh.scale.z).toBe(240);
    } finally {
      shell.dispose();
    }
  });

  it('never emits a filled Mesh or SphereGeometry — the wire envelope is line-only', () => {
    const shell = createRangeShell(100);
    try {
      // Walk the tree: no Mesh anywhere in the shell, no SphereGeometry on any child.
      shell.mesh.traverse((obj) => {
        expect(obj).not.toBeInstanceOf(Mesh);
      });
      for (const child of rootChildren(shell.mesh)) {
        expect(child).toBeInstanceOf(LineLoop);
        const loop = child as LineLoop;
        expect(loop.geometry).not.toBeInstanceOf(SphereGeometry);
        expect(loop.geometry).toBeInstanceOf(BufferGeometry);
      }
    } finally {
      shell.dispose();
    }
  });

  it('composes three orthogonal great-circle line loops', () => {
    const shell = createRangeShell(50);
    try {
      const loops = rootChildren(shell.mesh).filter(
        (c): c is LineLoop => c instanceof LineLoop,
      );
      expect(loops.length).toBe(3);
      // For each loop, exactly one of x/y/z carries zero across every vertex —
      // that "flat axis" is what makes the three loops mutually orthogonal.
      const flatAxes = new Set<'x' | 'y' | 'z'>();
      for (const loop of loops) {
        const posAttr = loop.geometry.getAttribute('position');
        expect(posAttr).toBeDefined();
        const positions = posAttr.array as ArrayLike<number>;
        const stride = 3;
        const count = positions.length / stride;
        expect(count).toBeGreaterThan(8); // enough to read as circular
        let allZeroX = true;
        let allZeroY = true;
        let allZeroZ = true;
        for (let i = 0; i < count; i += 1) {
          if (positions[i * stride]! !== 0) allZeroX = false;
          if (positions[i * stride + 1]! !== 0) allZeroY = false;
          if (positions[i * stride + 2]! !== 0) allZeroZ = false;
        }
        const flat: 'x' | 'y' | 'z' = allZeroX ? 'x' : allZeroY ? 'y' : 'z';
        expect(allZeroX || allZeroY || allZeroZ).toBe(true);
        flatAxes.add(flat);
      }
      expect(flatAxes.size).toBe(3); // all three planes present, hence orthogonal
    } finally {
      shell.dispose();
    }
  });

  it('shares one line material across every loop, transparent with no depth write', () => {
    const shell = createRangeShell(120);
    try {
      const loops = rootChildren(shell.mesh).filter(
        (c): c is LineLoop => c instanceof LineLoop,
      );
      const materials = new Set<LineBasicMaterial>();
      for (const loop of loops) {
        const mat = loop.material as LineBasicMaterial;
        expect(mat).toBeInstanceOf(LineBasicMaterial);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        expect(mat.opacity).toBeGreaterThan(0);
        expect(mat.opacity).toBeLessThan(1);
        materials.add(mat);
      }
      expect(materials.size).toBe(1); // shared material — one dispose covers all loops
    } finally {
      shell.dispose();
    }
  });

  it('setRadius rescales the root uniformly', () => {
    const shell = createRangeShell(1);
    try {
      shell.setRadius(320);
      expect(shell.mesh.scale.x).toBe(320);
      expect(shell.mesh.scale.y).toBe(320);
      expect(shell.mesh.scale.z).toBe(320);
      shell.setRadius(80);
      expect(shell.mesh.scale.x).toBe(80);
    } finally {
      shell.dispose();
    }
  });

  it('setRadius clamps non-finite and negative inputs to zero (no invalid matrices)', () => {
    const shell = createRangeShell(10);
    try {
      shell.setRadius(-42);
      expect(shell.mesh.scale.x).toBe(0);
      shell.setRadius(Number.NaN);
      expect(shell.mesh.scale.x).toBe(0);
      shell.setRadius(Number.POSITIVE_INFINITY);
      expect(shell.mesh.scale.x).toBe(0);
      shell.setRadius(15);
      expect(shell.mesh.scale.x).toBe(15);
    } finally {
      shell.dispose();
    }
  });

  it('setCenter moves the root to the supplied world position', () => {
    const shell = createRangeShell(120);
    try {
      shell.setCenter(12, -34, 56);
      expect(shell.mesh.position.x).toBe(12);
      expect(shell.mesh.position.y).toBe(-34);
      expect(shell.mesh.position.z).toBe(56);
      shell.setCenter(0, 0, 0);
      expect(shell.mesh.position.x).toBe(0);
      expect(shell.mesh.position.y).toBe(0);
      expect(shell.mesh.position.z).toBe(0);
    } finally {
      shell.dispose();
    }
  });

  it('setVisible toggles the root visibility flag', () => {
    const shell = createRangeShell(120);
    try {
      shell.setVisible(false);
      expect(shell.mesh.visible).toBe(false);
      shell.setVisible(true);
      expect(shell.mesh.visible).toBe(true);
    } finally {
      shell.dispose();
    }
  });

  it('setQuality reduces opacity without abandoning the line primitive', () => {
    const shell = createRangeShell(200);
    try {
      const loops = rootChildren(shell.mesh).filter(
        (c): c is LineLoop => c instanceof LineLoop,
      );
      const mat = loops[0]!.material as LineBasicMaterial;
      const highOpacity = mat.opacity;
      shell.setQuality('reduced');
      expect(mat.opacity).toBeLessThan(highOpacity);
      // Still a line envelope — no filled Mesh smuggled in on quality change.
      for (const child of rootChildren(shell.mesh)) {
        expect(child).toBeInstanceOf(LineLoop);
      }
      shell.setQuality('high');
      expect(mat.opacity).toBe(highOpacity);
    } finally {
      shell.dispose();
    }
  });

  it('dispose releases every owned geometry + the shared material exactly once', () => {
    const shell = createRangeShell(120);
    const loops = rootChildren(shell.mesh).filter(
      (c): c is LineLoop => c instanceof LineLoop,
    );
    const geometryCalls = new Map<BufferGeometry, number>();
    for (const loop of loops) {
      const g = loop.geometry;
      const original = g.dispose.bind(g);
      geometryCalls.set(g, 0);
      g.dispose = () => {
        geometryCalls.set(g, (geometryCalls.get(g) ?? 0) + 1);
        original();
      };
    }
    const material = loops[0]!.material as LineBasicMaterial;
    let materialCalls = 0;
    const originalMat = material.dispose.bind(material);
    material.dispose = () => {
      materialCalls += 1;
      originalMat();
    };

    shell.dispose();
    expect(materialCalls).toBe(1);
    for (const [, count] of geometryCalls) expect(count).toBe(1);

    // Repeated dispose is harmless — no extra release calls, no throw.
    expect(() => shell.dispose()).not.toThrow();
    expect(materialCalls).toBe(1);
    for (const [, count] of geometryCalls) expect(count).toBe(1);
  });
});
