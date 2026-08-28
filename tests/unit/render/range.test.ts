// range — the RangeShell handle contract. WebGL rendering is a screen-e2e
// concern; this asserts the pure surface the screen holds: construction
// returns the documented handle, mutators mutate the mesh's own properties
// (scale for radius, position for centre, `visible` for the toggle), quality
// degrade flips the material side without throwing, and dispose is idempotent
// against the geometry / material lifetimes.

import { describe, expect, it } from 'vitest';
import { BackSide, DoubleSide, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { createRangeShell } from '../../../src/render/range.js';

describe('createRangeShell', () => {
  it('returns the documented handle shape at the initial radius', () => {
    const shell = createRangeShell(240);
    try {
      expect(shell.mesh).toBeInstanceOf(Mesh);
      expect(shell.mesh.geometry).toBeInstanceOf(SphereGeometry);
      expect(shell.mesh.material).toBeInstanceOf(MeshBasicMaterial);
      expect(shell.mesh.scale.x).toBe(240);
      expect(shell.mesh.scale.y).toBe(240);
      expect(shell.mesh.scale.z).toBe(240);
      // Translucent so it never occludes ship glyphs (Stroke 4 legibility).
      const mat = shell.mesh.material as MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.opacity).toBeGreaterThan(0);
      expect(mat.opacity).toBeLessThan(1);
    } finally {
      shell.dispose();
    }
  });

  it('setRadius rescales the sphere uniformly', () => {
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

  it('setCenter moves the mesh to the supplied world position', () => {
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

  it('setVisible toggles the mesh visibility flag', () => {
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

  it('setQuality flips the material side under reduced motion', () => {
    const shell = createRangeShell(200);
    try {
      const mat = shell.mesh.material as MeshBasicMaterial;
      shell.setQuality('reduced');
      expect(mat.side).toBe(BackSide);
      shell.setQuality('high');
      expect(mat.side).toBe(DoubleSide);
    } finally {
      shell.dispose();
    }
  });

  it('dispose releases the geometry and material without throwing', () => {
    const shell = createRangeShell(120);
    expect(() => shell.dispose()).not.toThrow();
  });
});
