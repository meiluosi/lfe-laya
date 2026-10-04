export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    world: (
      <>
        <circle cx="12" cy="12" r="8" />
        <ellipse cx="12" cy="12" rx="4" ry="8" />
        <path d="M4 12h16" />
      </>
    ),
    leaf: (
      <>
        <path d="M19 4C8 3 3 8 6 15s14 4 13-11Z" />
        <path d="m5 20 9-10" />
      </>
    ),
    chart: (
      <>
        <path d="M4 4v16h16M7 14l4-5 4 3 5-7" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    step: (
      <>
        <path d="m5 5 10 7-10 7V5ZM19 5v14" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    target: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    drop: <path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z" />,
    book: (
      <>
        <path d="M12 6v15M12 6C9 3 5 3 3 4v14c4-1 7 0 9 3 2-3 5-4 9-3V4c-2-1-6-1-9 2Z" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-7h10v7" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    check: <path d="m5 12 5 5L20 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.info}
    </svg>
  );
}
