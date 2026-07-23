"use client";

/**
 * BlockForms.tsx — the inline edit form for each block kind, rendered by
 * BlockEditorCard.tsx. Every form is a plain controlled-input component:
 * `data` in, `onChange(next)` out with a shallow-merged partial. Styling
 * reuses the app's existing input treatment (see ParamsPanel.tsx /
 * ActionModal.tsx) — no new global CSS.
 */
import type { ActionArgSpec, ActionSpec, Caps, CheckSpec, GraphSpec, ImuSpec, ParamSpec, ParamType, RailSpec } from "@/lib/types";
import type { MetaData } from "@/lib/builder/types";
import { uid } from "@/lib/builder/types";

const inputCls =
  "w-full rounded border border-hairline-bright bg-bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-cyan";
const labelCls = "label-caps block text-[9px] text-ink-faint mb-0.5";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function IdField({
  value,
  onChange,
  invalid,
  duplicate,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  const bad = invalid || duplicate;
  return (
    <Field label="id (tlm key)">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} tabular ${bad ? "!border-red text-red" : ""}`}
      />
      {invalid && <p className="mt-0.5 text-[10px] text-red">no spaces — must match TLM key tokenizer</p>}
      {!invalid && duplicate && <p className="mt-0.5 text-[10px] text-red">duplicate id in this block type</p>}
    </Field>
  );
}

const ACCENTS = ["cyan", "blue", "green", "red", "yellow", "amber", "magenta", "orange", "white"];

export function MetaForm({ data, onChange }: { data: MetaData; onChange: (d: Partial<MetaData>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Field label="name">
        <input className={inputCls} value={data.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label="fw">
        <input className={`${inputCls} tabular`} value={data.fw} onChange={(e) => onChange({ fw: e.target.value })} />
      </Field>
      <Field label="sub" className="sm:col-span-2">
        <input className={inputCls} value={data.sub} onChange={(e) => onChange({ sub: e.target.value })} />
      </Field>
      <Field label="accent">
        <select className={inputCls} value={data.accent} onChange={(e) => onChange({ accent: e.target.value })}>
          {ACCENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function CheckForm({
  data,
  onChange,
  invalid,
  duplicate,
}: {
  data: CheckSpec;
  onChange: (d: Partial<CheckSpec>) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <IdField value={data.id} onChange={(id) => onChange({ id })} invalid={invalid} duplicate={duplicate} />
      <Field label="label">
        <input className={inputCls} value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="check (TLM bool key, blank = informational)">
        <input
          className={`${inputCls} tabular`}
          value={data.check || ""}
          onChange={(e) => onChange({ check: e.target.value || undefined })}
          placeholder="e.g. baro_ok"
        />
      </Field>
    </div>
  );
}

export function RailForm({
  data,
  onChange,
  invalid,
  duplicate,
}: {
  data: RailSpec;
  onChange: (d: Partial<RailSpec>) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <IdField value={data.id} onChange={(id) => onChange({ id })} invalid={invalid} duplicate={duplicate} />
      <Field label="label">
        <input className={inputCls} value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="min (V)">
        <input
          type="number"
          className={`${inputCls} tabular`}
          value={data.min ?? ""}
          onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
      </Field>
      <Field label="max (V)">
        <input
          type="number"
          className={`${inputCls} tabular`}
          value={data.max ?? ""}
          onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
      </Field>
      <Field label="nom (V)">
        <input
          type="number"
          className={`${inputCls} tabular`}
          value={data.nom ?? ""}
          onChange={(e) => onChange({ nom: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}

export function GraphForm({
  data,
  onChange,
  invalid,
  duplicate,
}: {
  data: GraphSpec;
  onChange: (d: Partial<GraphSpec>) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <IdField value={data.id} onChange={(id) => onChange({ id })} invalid={invalid} duplicate={duplicate} />
      <Field label="label">
        <input className={inputCls} value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="unit">
        <input
          className={`${inputCls} tabular`}
          value={data.unit || ""}
          onChange={(e) => onChange({ unit: e.target.value || undefined })}
          placeholder="m, m/s, g, Pa, C…"
        />
      </Field>
    </div>
  );
}

const PARAM_TYPES: ParamType[] = ["float", "int", "bool", "enum"];

export function ParamForm({
  data,
  onChange,
  invalid,
  duplicate,
}: {
  data: ParamSpec;
  onChange: (d: Partial<ParamSpec>) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <IdField value={data.id} onChange={(id) => onChange({ id })} invalid={invalid} duplicate={duplicate} />
        <Field label="label">
          <input className={inputCls} value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="type">
          <select
            className={inputCls}
            value={data.type}
            onChange={(e) => {
              const type = e.target.value as ParamType;
              const value = type === "bool" ? Boolean(data.value) : type === "enum" ? String(data.value ?? "") : Number(data.value) || 0;
              onChange({ type, value });
            }}
          >
            {PARAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="unit">
          <input
            className={inputCls}
            value={data.unit || ""}
            onChange={(e) => onChange({ unit: e.target.value || undefined })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        {data.type === "enum" ? (
          <Field label="values (comma-separated)" className="sm:col-span-2">
            <input
              className={inputCls}
              value={(data.values || []).join(",")}
              onChange={(e) => onChange({ values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
            />
          </Field>
        ) : data.type === "bool" ? null : (
          <>
            <Field label="min">
              <input
                type="number"
                className={`${inputCls} tabular`}
                value={data.min ?? ""}
                onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="max">
              <input
                type="number"
                className={`${inputCls} tabular`}
                value={data.max ?? ""}
                onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </Field>
          </>
        )}
        <Field label="default value">
          {data.type === "bool" ? (
            <select
              className={inputCls}
              value={data.value ? "true" : "false"}
              onChange={(e) => onChange({ value: e.target.value === "true" })}
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : data.type === "enum" ? (
            <select className={inputCls} value={String(data.value)} onChange={(e) => onChange({ value: e.target.value })}>
              {(data.values || []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              className={`${inputCls} tabular`}
              value={Number(data.value) || 0}
              onChange={(e) => onChange({ value: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

function ActionArgRow({
  arg,
  onChange,
  onRemove,
}: {
  arg: ActionArgSpec;
  onChange: (d: Partial<ActionArgSpec>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="frost grid grid-cols-2 gap-1.5 p-1.5 sm:grid-cols-5">
      <input
        className={`${inputCls} tabular`}
        placeholder="arg id"
        value={arg.id}
        onChange={(e) => onChange({ id: e.target.value })}
      />
      <input
        className={inputCls}
        placeholder="label"
        value={arg.label || ""}
        onChange={(e) => onChange({ label: e.target.value || undefined })}
      />
      <select
        className={inputCls}
        value={arg.values ? "enum" : arg.type || "int"}
        onChange={(e) => onChange({ type: e.target.value === "enum" ? "enum" : e.target.value, values: e.target.value === "enum" ? arg.values || [""] : undefined })}
      >
        <option value="int">int</option>
        <option value="float">float</option>
        <option value="enum">enum</option>
      </select>
      {arg.values ? (
        <input
          className={`${inputCls} sm:col-span-1`}
          placeholder="values, comma-sep"
          value={arg.values.join(",")}
          onChange={(e) => onChange({ values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
        />
      ) : (
        <>
          <input
            type="number"
            className={`${inputCls} tabular`}
            placeholder="min"
            value={arg.min ?? ""}
            onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <input
            type="number"
            className={`${inputCls} tabular`}
            placeholder="max"
            value={arg.max ?? ""}
            onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </>
      )}
      <button onClick={onRemove} className="pill px-2 py-0.5 text-[10px] hover:!text-red">
        remove arg
      </button>
    </div>
  );
}

export function ActionForm({
  data,
  onChange,
  invalid,
  duplicate,
}: {
  data: ActionSpec;
  onChange: (d: Partial<ActionSpec>) => void;
  invalid: boolean;
  duplicate: boolean;
}) {
  const args = data.args || [];
  const setArgs = (next: ActionArgSpec[]) => onChange({ args: next.length ? next : undefined });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <IdField value={data.id} onChange={(id) => onChange({ id })} invalid={invalid} duplicate={duplicate} />
        <Field label="label">
          <input className={inputCls} value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="confirm token (blank = none)">
          <input
            className={`${inputCls} tabular uppercase`}
            value={data.confirm || ""}
            onChange={(e) => onChange({ confirm: e.target.value || undefined })}
            placeholder="e.g. FIRE"
          />
        </Field>
        <label className="flex items-end gap-1.5 pb-1 text-[11px] text-ink-dim">
          <input type="checkbox" checked={!!data.danger} onChange={(e) => onChange({ danger: e.target.checked || undefined })} />
          danger (red styling)
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        {args.map((a, i) => (
          <ActionArgRow
            key={i}
            arg={a}
            onChange={(d) => setArgs(args.map((x, j) => (j === i ? { ...x, ...d } : x)))}
            onRemove={() => setArgs(args.filter((_, j) => j !== i))}
          />
        ))}
        <button
          onClick={() => setArgs([...args, { id: `arg${args.length + 1}`, type: "int" }])}
          className="pill self-start px-2.5 py-1 text-[10px] label-caps hover:!text-cyan"
        >
          + add arg
        </button>
      </div>
    </div>
  );
}

const UP_AXES: ImuSpec["up"][] = ["+x", "-x", "+y", "-y", "+z", "-z"];

export function ImuForm({ data, onChange }: { data: ImuSpec; onChange: (d: Partial<ImuSpec>) => void }) {
  const [ax, ay, az] = data.accel;
  const setAccel = (i: number, v: string) => {
    const next: [string, string, string] = [...data.accel] as [string, string, string];
    next[i] = v;
    onChange({ accel: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Field label="accel[0] (x raw TLM key)">
          <input className={`${inputCls} tabular`} value={ax} onChange={(e) => setAccel(0, e.target.value)} />
        </Field>
        <Field label="accel[1] (y raw TLM key)">
          <input className={`${inputCls} tabular`} value={ay} onChange={(e) => setAccel(1, e.target.value)} />
        </Field>
        <Field label="accel[2] (z raw TLM key)">
          <input className={`${inputCls} tabular`} value={az} onChange={(e) => setAccel(2, e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="up (flight axis label)">
          <select className={inputCls} value={data.up} onChange={(e) => onChange({ up: e.target.value as ImuSpec["up"] })}>
            {UP_AXES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="units">
          <input className={inputCls} value={data.units || ""} onChange={(e) => onChange({ units: e.target.value || undefined })} />
        </Field>
        <Field label="g_rest">
          <input
            type="number"
            step="0.01"
            className={`${inputCls} tabular`}
            value={data.g_rest ?? ""}
            onChange={(e) => onChange({ g_rest: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
      </div>
      <p className="text-[10px] text-ink-faint">
        `map` defaults to identity (+x,+y,+z) here — a real board solves it with the Calibrate wizard on the main dashboard.
      </p>
    </div>
  );
}

export function CapsForm({ data, onChange }: { data: Caps; onChange: (d: Partial<Caps>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Field label="pyro channels">
        <input
          type="number"
          min={0}
          max={6}
          className={`${inputCls} tabular`}
          value={Number(data.pyro) || 0}
          onChange={(e) => onChange({ pyro: Number(e.target.value) })}
        />
      </Field>
      {(["arm", "logs", "telemetry", "integrity"] as const).map((k) => (
        <label key={k} className="flex items-end gap-1.5 pb-1 text-[11px] text-ink-dim">
          <input type="checkbox" checked={!!data[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
          {k}
        </label>
      ))}
    </div>
  );
}

export { uid as newUid };
