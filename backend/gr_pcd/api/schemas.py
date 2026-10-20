"""Request models. Floats are finite; unknown keys are rejected."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from gr_pcd.editing.protection import (
    Interval,
    OperationProtection,
    ProtectionState,
    Tilt,
)
from gr_pcd.editing.sparse import DEFAULT_MIN_NEIGHBOURS, SparseSpec
from gr_pcd.geometry.box import BoxSpec
from gr_pcd.geometry.filters import AxisRange, DisplayFilter
from gr_pcd.geometry.prism import PrismSpec
from gr_pcd.session.codec import ClusterTool, FilterTool, LayerTool

Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
Vec2 = Annotated[list[float], Field(min_length=2, max_length=2)]


class Model(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")


class BoxTool(Model):
    type: Literal["box"]
    center: Vec3
    dimensions: Vec3
    rpy_deg: Vec3 = [0.0, 0.0, 0.0]
    mode: Literal["inside", "outside"] = "inside"

    def to_spec(self) -> BoxSpec:
        return BoxSpec(
            tuple(self.center),
            tuple(self.dimensions),
            tuple(self.rpy_deg),
            self.mode,
        )


class PrismTool(Model):
    type: Literal["prism"]
    polygon: list[Vec2]
    z_min: float
    z_max: float
    mode: Literal["inside", "outside"] = "inside"

    def to_spec(self) -> PrismSpec:
        return PrismSpec(
            tuple(tuple(v) for v in self.polygon),
            self.z_min,
            self.z_max,
            self.mode,
        )


class FilterToolBody(Model):
    type: Literal["filter"]

    def to_spec(self) -> FilterTool:
        return FilterTool()


Region = Annotated[BoxTool | PrismTool, Field(discriminator="type")]


class ClusterToolBody(Model):
    type: Literal["cluster"]
    seed_id: int
    radius: float
    region: Region | None = None
    exclude_protected: bool = True
    max_points: int | None = 2_000_000
    on_limit: Literal["fail", "partial"] = "fail"

    def to_spec(self) -> ClusterTool:
        return ClusterTool(
            self.seed_id,
            self.radius,
            None if self.region is None else self.region.to_spec(),
            self.exclude_protected,
            self.max_points,
            self.on_limit,
        )


class SparseToolBody(Model):
    type: Literal["sparse"]
    radius: float | None = None  # None: derived from the sample spacing
    min_neighbours: int = DEFAULT_MIN_NEIGHBOURS
    region: Region | None = None
    exclude_protected: bool = True

    def to_spec(self) -> SparseSpec:
        return SparseSpec(
            self.radius,
            self.min_neighbours,
            None if self.region is None else self.region.to_spec(),
            self.exclude_protected,
        )


class LayerToolBody(Model):
    type: Literal["layer"]
    layer_id: int = Field(ge=1, le=255)

    def to_spec(self) -> LayerTool:
        return LayerTool(self.layer_id)


Tool = Annotated[
    BoxTool
    | PrismTool
    | FilterToolBody
    | ClusterToolBody
    | SparseToolBody
    | LayerToolBody,
    Field(discriminator="type"),
]


class AxisBody(Model):
    enabled: bool = False
    min: float = 0.0
    max: float = 0.0


class DisplayFilterBody(Model):
    x: AxisBody = AxisBody()
    y: AxisBody = AxisBody()
    z: AxisBody = AxisBody()

    def to_spec(self) -> DisplayFilter:
        return DisplayFilter(
            *(
                AxisRange(a.enabled, a.min, a.max)
                for a in (self.x, self.y, self.z)
            )
        )


class IntervalBody(Model):
    enabled: bool = False
    min: float = 0.0
    max: float = 0.0


class LocalBody(Model):
    min: float
    max: float


class OperationBody(Model):
    mode: Literal["inherit", "add_local", "override"] = "inherit"
    local: LocalBody | None = None
    acknowledge_override: bool = False


class TiltBody(Model):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    rx_deg: float
    ry_deg: float
    pivot: tuple[float, float] = (0.0, 0.0)


class ProtectionBody(Model):
    model_config = ConfigDict(
        allow_inf_nan=False, extra="forbid", populate_by_name=True
    )
    global_: IntervalBody = Field(default=IntervalBody(), alias="global")
    operation: OperationBody = OperationBody()
    tilt: TiltBody | None = None

    def to_spec(self) -> ProtectionState:
        op = self.operation
        t = self.tilt
        return ProtectionState(
            Interval(self.global_.enabled, self.global_.min, self.global_.max),
            OperationProtection(
                op.mode,
                None if op.local is None else (op.local.min, op.local.max),
                op.acknowledge_override,
            ),
            Tilt() if t is None else Tilt(t.rx_deg, t.ry_deg, t.pivot),
        )


class SelectionBody(Model):
    cloud_revision: int
    op: Literal["replace", "add", "subtract", "intersect", "invert"]
    scope: Literal["displayed", "active"] = "displayed"
    tool: Tool | None = None
    evaluate_candidate: bool = True


class PreviewBody(Model):
    cloud_revision: int
    op: str  # add | subtract | intersect, checked by the route (422 invalid_op)
    scope: Literal["displayed", "active"] = "displayed"
    tool: Tool | None = None


class CommitBody(Model):
    cloud_revision: int
    preview_id: str
    evaluate_candidate: bool = True


class RevisionBody(Model):
    cloud_revision: int


class RollbackBody(Model):
    cloud_revision: int
    cursor: int


class LayerCreateBody(Model):
    cloud_revision: int
    name: str | None = None
    visible: bool = True
    dry_run: bool = False


class LayerAssignBody(Model):
    cloud_revision: int
    visible: bool | None = None
    dry_run: bool = False


class LayerMembersBody(Model):
    cloud_revision: int
    dry_run: bool = False


class LayerPatchBody(Model):
    name: str | None = None
    # a plain int: the engine answers invalid_colour for anything else
    colour: int | str | float | None = None
    visible: bool | None = None


class LayerVisibilityBody(Model):
    ids: list[int] | None
    visible: bool


class DeleteStepBody(Model):
    cloud_revision: int
    sid: int


class RenameBody(Model):
    sid: int
    name: str


class ApplyBody(Model):
    cloud_revision: int
    candidate_id: str
    description: str | None = None


class NearestBody(Model):
    point: Vec3
    radius: float = Field(gt=0)


class ExportBody(Model):
    format: Literal["binary", "ascii"] = "binary"
    scope: Literal["active", "selected", "displayed"] = "active"
    # layer ids to export (0 = main); None = every layer
    layers: list[int] | None = None


class MarkSavedBody(Model):
    archive_id: str
