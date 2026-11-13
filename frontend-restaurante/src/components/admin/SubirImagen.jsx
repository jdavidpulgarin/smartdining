import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { imagenesApi } from '../../services/api'
import { urlImagen } from '../../utils/imagenes'
import { ACEPTA_IMAGEN, revisarArchivoImagen, mensajeErrorSubida } from '../../utils/subidaImagen'

/**
 * Subir la imagen de un plato o ingrediente (D-23, #209) con vista previa.
 *
 * - Antes de subir revisa tamaño y tipo por el contenido (los mismos límites del
 *   backend); si no pasa, no llama al servidor.
 * - Mientras sube, la vista previa es el archivo elegido (local). Al terminar,
 *   onCambio(ruta) pone /imagenes/<uuid>.webp en el campo url_imagen y la vista
 *   previa pasa a ser la imagen ya servida por el backend.
 * - La subida no toca la base: el plato o el ingrediente se guardan después,
 *   con su botón de siempre. onSubiendo avisa para no guardar a medias.
 *
 * @param {{ valor: string, onCambio: (ruta: string) => void, onSubiendo?: (s: boolean) => void, etiqueta?: string }} props
 */
export function SubirImagen({ valor, onCambio, onSubiendo, etiqueta = 'imagen' }) {
  const entrada = useRef(null)
  const [local, setLocal] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [falloVista, setFalloVista] = useState(null)

  // La URL local del archivo elegido se libera al cambiarla o al desmontar.
  useEffect(() => () => { if (local) URL.revokeObjectURL(local) }, [local])

  const vista = local || urlImagen(valor)

  const elegir = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setError(null)
    setAviso(null)
    const motivo = await revisarArchivoImagen(archivo)
    if (motivo) {
      setError(motivo)
      return
    }
    setLocal(URL.createObjectURL(archivo))
    setSubiendo(true)
    onSubiendo?.(true)
    try {
      const { ruta } = await imagenesApi.subir(archivo)
      onCambio(ruta)
      setAviso('Imagen subida. Se guarda al guardar.')
      setLocal(null)
    } catch (err) {
      setError(mensajeErrorSubida(err))
      setLocal(null)
    } finally {
      setSubiendo(false)
      onSubiendo?.(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
      <div
        style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#0a0807', border: '1px solid var(--sd-border)', display: 'grid', placeItems: 'center' }}
      >
        {vista && falloVista !== vista ? (
          <img
            src={vista}
            alt={`Vista previa de la ${etiqueta}`}
            onError={() => setFalloVista(vista)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: subiendo ? 0.5 : 1 }}
          />
        ) : (
          <span style={{ fontSize: 11, color: 'var(--sd-text-muted)', textAlign: 'center', padding: 4 }}>
            {vista ? 'No carga' : 'Sin imagen'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <input ref={entrada} type="file" accept={ACEPTA_IMAGEN} onChange={elegir} hidden data-testid="subir-imagen-archivo" />
        <button
          type="button"
          className="sd-btn sd-btn-secondary"
          style={{ padding: '6px 12px', fontSize: 12, alignSelf: 'flex-start' }}
          onClick={() => entrada.current?.click()}
          disabled={subiendo}
        >
          {subiendo ? <Loader2 size={14} className="sd-spin" /> : <ImagePlus size={14} />}
          <span>{subiendo ? 'SUBIENDO…' : 'SUBIR IMAGEN'}</span>
        </button>
        <span style={{ fontSize: 11, color: 'var(--sd-text-muted)' }}>JPEG, PNG o WebP, hasta 2 MB.</span>
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--sd-red)' }}>{error}</span>}
        {aviso && <span role="status" style={{ fontSize: 12, color: 'var(--sd-green, #4caf50)' }}>{aviso}</span>}
      </div>
    </div>
  )
}
