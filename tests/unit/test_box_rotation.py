"""BXR-: the oriented box for all three rotation axes (Part 14, characterization).

Part 14 adds no backend code: the box already rotates about roll, pitch and yaw. These tests pin that,
against an oracle that builds the rotation from axis-angle (Rodrigues) rotations, not from the
production matrix. They were written after the code and are expected to be green on arrival.
"""

import math

import numpy as np
import pytest
from pydantic import ValidationError

from gr_pcd.api.schemas import BoxTool
from gr_pcd.geometry.box import BoxSpec, box_contains


def axis_rot(axis: int, deg: float) -> np.ndarray:
    """Rodrigues rotation about a unit coordinate axis."""
    k = np.zeros(3)
    k[axis] = 1.0
    a = math.radians(deg)
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * kx + (1 - math.cos(a)) * (kx @ kx)


def oracle_rot(rpy) -> np.ndarray:
    """local -> world: yaw about Z applied last, roll about X first."""
    return axis_rot(2, rpy[2]) @ axis_rot(1, rpy[1]) @ axis_rot(0, rpy[0])


def oracle(xyz, c, d, rpy, mode="inside", slack=1e-9):
    """Per-point loop: |R^T (p - c)| <= half + slack."""
    r = oracle_rot(rpy)
    half = np.asarray(d, dtype=np.float64) / 2
    out = []
    for p in xyz:
        local = r.T @ (np.asarray(p, dtype=np.float64) - np.asarray(c))
        inside = bool((np.abs(local) <= half + slack).all())
        out.append(inside if mode == "inside" else not inside)
    return np.array(out, dtype=bool)


def cloud(rng, n=400, spread=6.0):
    xyz = rng.uniform(-spread, spread, size=(n, 3))
    return xyz, np.ones(n, dtype=bool)


def test_bxr_01_random_rotated_boxes_equal_the_per_point_oracle():
    rng = np.random.default_rng(14001)
    xyz, valid = cloud(rng)
    for _ in range(300):
        c = rng.uniform(-3, 3, 3)
        d = rng.uniform(0.5, 6, 3)
        rpy = tuple(rng.uniform(5, 175, 3) * rng.choice([-1, 1], 3))
        got = box_contains(xyz, valid, BoxSpec(tuple(c), tuple(d), rpy))
        assert got.tolist() == oracle(xyz, c, d, rpy).tolist(), (c, d, rpy)


def test_bxr_02_level_and_yaw_only_masks_equal_the_pre_change_reference():
    rng = np.random.default_rng(14002)
    xyz, valid = cloud(rng, 2000)
    for _ in range(40):
        c = rng.uniform(-3, 3, 3)
        d = rng.uniform(0.5, 6, 3)
        half = d / 2
        level = box_contains(xyz, valid, BoxSpec(tuple(c), tuple(d)))
        ref = (np.abs(xyz - c) <= half).all(
            axis=1
        )  # the world-axis formula, no rotation, eps 0
        assert np.array_equal(level, ref)
        yaw = float(rng.uniform(1, 179))
        a = math.radians(yaw)
        rz = np.array(
            [
                [math.cos(a), -math.sin(a), 0],
                [math.sin(a), math.cos(a), 0],
                [0, 0, 1],
            ]
        )
        ref_yaw = (np.abs((xyz - c) @ rz) <= half + 1e-9).all(axis=1)
        got = box_contains(
            xyz, valid, BoxSpec(tuple(c), tuple(d), (0.0, 0.0, yaw))
        )
        assert np.array_equal(got, ref_yaw)


@pytest.mark.parametrize(
    "rpy",
    [
        (0, 90, 0),
        (0, -90, 0),
        (30, 90, 0),
        (-45, -90, 20),
        (40, 0, 0),
        (0, 40, 0),
        (0, 0, 40),
        (90, 90, 90),
    ],
)
def test_bxr_03_gimbal_pitch_and_single_axis_boxes(rpy):
    rng = np.random.default_rng(14003)
    xyz, valid = cloud(rng, 600)
    c, d = (0.3, -0.2, 0.5), (4.0, 2.0, 3.0)
    got = box_contains(xyz, valid, BoxSpec(c, d, tuple(float(v) for v in rpy)))
    assert got.tolist() == oracle(xyz, c, d, rpy).tolist()
    assert 0 < int(got.sum()) < len(xyz)


def test_bxr_04_outside_with_rotation_is_the_complement_on_valid_points():
    rng = np.random.default_rng(14004)
    xyz, valid = cloud(rng, 500)
    valid[::7] = False
    spec = {
        "center": (0.5, 0.5, 0.5),
        "dimensions": (3.0, 4.0, 2.0),
        "rpy_deg": (25.0, -35.0, 70.0),
    }
    inside = box_contains(xyz, valid, BoxSpec(**spec))
    outside = box_contains(xyz, valid, BoxSpec(**spec, mode="outside"))
    assert not (inside & outside).any()
    assert (inside | outside).tolist() == valid.tolist()


def test_bxr_05_wire_accepts_three_finite_angles_and_rejects_the_rest():
    base = {"type": "box", "center": [0, 0, 0], "dimensions": [1, 1, 1]}
    assert BoxTool(**base).rpy_deg == [0.0, 0.0, 0.0]
    assert BoxTool(**base, rpy_deg=[10, -20, 30]).to_spec().rpy_deg == (
        10,
        -20,
        30,
    )
    for bad in (
        [0, 0],
        [0, 0, 0, 0],
        [0, 0, float("nan")],
        [float("inf"), 0, 0],
        [0, "x", 0],
    ):
        with pytest.raises(ValidationError):
            BoxTool(**base, rpy_deg=bad)


def matrix_from_quat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def rpy_from_matrix(m: np.ndarray):
    """The frontend's quatToRpy rule: pitch = asin(-m20), gimbal case reports yaw 0."""
    pitch = math.asin(max(-1.0, min(1.0, -m[2, 0])))
    if abs(m[2, 0]) < 1 - 1e-12:
        return (
            math.degrees(math.atan2(m[2, 1], m[2, 2])),
            math.degrees(pitch),
            math.degrees(math.atan2(m[1, 0], m[0, 0])),
        )
    sp = 1 if -m[2, 0] > 0 else -1
    return (math.degrees(math.atan2(sp * m[0, 1], m[1, 1])), sp * 90.0, 0.0)


def test_bxr_06_quaternion_to_rpy_to_backend_round_trip_selects_the_quaternion_boxs_points():
    rng = np.random.default_rng(14006)
    xyz, valid = cloud(rng, 800)
    for _ in range(100):
        q = rng.normal(size=4)
        q /= np.linalg.norm(q)
        r = matrix_from_quat(q)
        rpy = rpy_from_matrix(r)
        c = rng.uniform(-2, 2, 3)
        d = rng.uniform(1, 5, 3)
        got = box_contains(xyz, valid, BoxSpec(tuple(c), tuple(d), rpy))
        local = (
            xyz - c
        ) @ r  # R^T (p - c) for rows, with the quaternion's own matrix
        want = (np.abs(local) <= d / 2 + 1e-9).all(axis=1)
        # points within float noise of a face may differ by the 1e-9 slack only
        margin = np.abs(np.abs(local) - d / 2).min(axis=1)
        assert (got == want)[margin > 1e-6].all()
