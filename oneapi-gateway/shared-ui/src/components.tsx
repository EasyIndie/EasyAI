import { forwardRef } from "react";
import type {
  CSSProperties,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

function cx(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dashed";
type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", block, type = "button", style, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("ui-button", className)}
      data-variant={variant}
      data-size={size}
      data-block={block ? "true" : undefined}
      style={{ ...(block ? { width: "100%" } : {}), ...style }}
      {...props}
    />
  );
});

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  fullWidth?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fullWidth, style, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx("ui-input", className)}
      data-full-width={fullWidth ? "true" : undefined}
      style={{ ...(fullWidth ? { width: "100%" } : {}), ...style }}
      {...props}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  fullWidth?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, fullWidth, style, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx("ui-select", className)}
      data-full-width={fullWidth ? "true" : undefined}
      style={{ ...(fullWidth ? { width: "100%" } : {}), ...style }}
      {...props}
    />
  );
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  fullWidth?: boolean;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, fullWidth, style, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx("ui-textarea", className)}
      data-full-width={fullWidth ? "true" : undefined}
      style={{ ...(fullWidth ? { width: "100%" } : {}), ...style }}
      {...props}
    />
  );
});

export function Card(props: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { children, className, style } = props;
  return (
    <div className={cx("ui-card", className)} style={style}>
      {children}
    </div>
  );
}

type TableProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  minWidth?: number | string;
};

export function Table(props: TableProps) {
  const { children, className, style, minWidth } = props;
  return (
    <div className="ui-table-wrap" style={style}>
      <table className={cx("ui-table", className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function TableHead(props: { children: ReactNode; className?: string }) {
  return <thead className={props.className}>{props.children}</thead>;
}

export function TableBody(props: { children: ReactNode; className?: string }) {
  return <tbody className={props.className}>{props.children}</tbody>;
}

export function TableRow(props: { children: ReactNode; className?: string }) {
  return <tr className={props.className}>{props.children}</tr>;
}

export function TableHeadCell(props: {
  children: ReactNode;
  className?: string;
  scope?: "col" | "row";
}) {
  return (
    <th className={props.className} scope={props.scope}>
      {props.children}
    </th>
  );
}

export function TableCell(props: { children: ReactNode; className?: string }) {
  return <td className={props.className}>{props.children}</td>;
}

export function Page(props: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { children, className, style } = props;
  return (
    <div className={cx("ui-page", className)} style={style}>
      {children}
    </div>
  );
}

export function Center(props: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { children, className, style } = props;
  return (
    <div className={cx("ui-center", className)} style={style}>
      {children}
    </div>
  );
}

export function Stack(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  gap?: number | string;
  align?: CSSProperties["alignItems"];
}) {
  const { children, className, style, gap = 12, align } = props;
  return (
    <div className={cx("ui-stack", className)} style={{ gap, alignItems: align, ...style }}>
      {children}
    </div>
  );
}

export function Inline(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  gap?: number | string;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
}) {
  const { children, className, style, gap = 12, align = "center", justify, wrap = true } = props;
  return (
    <div
      className={cx("ui-inline", className)}
      style={{ display: "flex", gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? "wrap" : "nowrap", ...style }}
    >
      {children}
    </div>
  );
}

export function Grid(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  gap?: number | string;
  columns?: string;
  minChildWidth?: number | string;
}) {
  const { children, className, style, gap = 12, columns, minChildWidth } = props;
  const gridTemplateColumns = columns ?? (minChildWidth ? `repeat(auto-fit, minmax(${typeof minChildWidth === "number" ? `${minChildWidth}px` : minChildWidth}, 1fr))` : undefined);
  return (
    <div className={cx("ui-grid", className)} style={{ gap, gridTemplateColumns, ...style }}>
      {children}
    </div>
  );
}

export function Section(props: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { title, description, children, className, style } = props;
  return (
    <section className={cx("ui-section", className)} style={style}>
      {(title || description) && (
        <div className="ui-section-header">
          {title ? <h3 className="ui-section-title">{title}</h3> : null}
          {description ? <div className="ui-section-description">{description}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field(props: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  style?: CSSProperties;
  compact?: boolean;
  orientation?: "stack" | "inline";
}) {
  const { label, children, hint, className, style, compact, orientation = "stack" } = props;
  return (
    <label className={cx("ui-field", className)} data-compact={compact ? "true" : undefined} data-orientation={orientation} style={style}>
      <span className="ui-field-label">{label}</span>
      {children}
      {hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

export function ActionBar(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
}) {
  const { children, className, style, align, justify } = props;
  return (
    <div className={cx("ui-action-bar", className)} style={{ alignItems: align, justifyContent: justify, ...style }}>
      {children}
    </div>
  );
}
