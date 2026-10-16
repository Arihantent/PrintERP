import cfg from '../app.config';

// Print Floor mark: the CMYK swatch bar from the app header.
export default function Brand() {
  return (
    <div className="ah-brand">
      <div className="ah-cmyk" aria-hidden="true"><i /><i /><i /><i /></div>
      <div>
        <div className="ah-brand-name">{cfg.brand}</div>
        <div className="ah-brand-sub">{cfg.company}</div>
      </div>
    </div>
  );
}
