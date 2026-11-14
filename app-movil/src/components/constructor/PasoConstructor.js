import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';
import { formatearPrecio } from '../../utils/formato';
import { urlImagen } from '../../utils/imagenes';
import Badge from '../ui/Badge';
import SelectorPorcion from './SelectorPorcion';

function obtenerTextoRegla(paso) {
  const min = Number(paso.min_sel) || 0;
  const max = Number(paso.max_sel) || 0;

  if (min > 0) {
    if (min === max) return `Elige ${min}`;
    if (max > min) return `Elige de ${min} a ${max}`;
    return `Elige al menos ${min}`;
  }

  if (max > 0) return `Opcional, hasta ${max}`;
  return 'Opcional';
}

export default function PasoConstructor({
  paso,
  seleccionesDelPaso = {},
  despachador,
}) {
  if (!paso) return null;

  const idsElegidos = Object.keys(seleccionesDelPaso);
  const cantidadElegida = idsElegidos.length;
  const esUnica = Number(paso.max_sel) === 1;
  const maxAlcanzado =
    !esUnica && Number(paso.max_sel) > 0 && cantidadElegida >= Number(paso.max_sel);
  const esObligatorio = Boolean(paso.obligatorio || Number(paso.min_sel) > 0);

  return (
    <View style={styles.seccion}>
      <View style={styles.cabecera}>
        <View style={styles.cabeceraTextos}>
          <Text style={styles.titulo}>{paso.nombre}</Text>
          <Text style={styles.regla}>{obtenerTextoRegla(paso)}</Text>
          {maxAlcanzado && (
            <Text style={styles.avisoMax}>
              Máximo alcanzado: quita uno para cambiarlo
            </Text>
          )}
        </View>
        <Badge variante={esObligatorio ? 'alerta' : 'neutro'}>
          {esObligatorio ? 'Obligatorio' : 'Opcional'}
        </Badge>
      </View>

      <View style={styles.lista}>
        {(paso.ingredientes || []).map((ingrediente) => {
          const idIng = ingrediente.id_ingrediente;
          const seleccionado = Object.prototype.hasOwnProperty.call(
            seleccionesDelPaso,
            idIng
          );
          const porcionElegida = seleccionesDelPaso[idIng] || 'normal';
          const agotado = ingrediente.disponible === false;
          const deshabilitado = agotado || (maxAlcanzado && !seleccionado);
          const ingredienteFotoUrl = urlImagen(ingrediente.url_imagen);

          return (
            <View key={idIng} style={styles.itemGrupo}>
              <Pressable
                disabled={deshabilitado}
                onPress={() =>
                  despachador({
                    type: 'ALTERNAR_INGREDIENTE',
                    paso,
                    ingrediente,
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: seleccionado, disabled: deshabilitado }}
                style={[
                  styles.tarjeta,
                  seleccionado && !deshabilitado && styles.tarjetaSeleccionada,
                  deshabilitado && styles.tarjetaDeshabilitada,
                ]}
              >
                {ingredienteFotoUrl ? (
                  <Image
                    source={{ uri: ingredienteFotoUrl }}
                    style={styles.foto}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.sinFoto} />
                )}

                <View style={styles.info}>
                  <View style={styles.nombreRow}>
                    <Text style={styles.nombre} numberOfLines={1}>
                      {ingrediente.nombre}
                    </Text>
                    {agotado && <Badge variante="alerta">Agotado</Badge>}
                  </View>
                  <View style={styles.metaRow}>
                    {Number(ingrediente.precio_extra) > 0 ? (
                      <Text style={styles.extraPrecio}>
                        Extra +{formatearPrecio(ingrediente.precio_extra)}
                      </Text>
                    ) : (
                      <Text style={styles.incluido}>Incluido</Text>
                    )}
                    {ingrediente.calorias != null ? (
                      <Text style={styles.calorias}>
                        · {ingrediente.calorias} kcal
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View
                  style={[
                    styles.checkCirculo,
                    seleccionado && !deshabilitado && styles.checkActivo,
                  ]}
                >
                  {seleccionado && !deshabilitado ? (
                    <Text style={styles.checkSimbolo}>✓</Text>
                  ) : null}
                </View>
              </Pressable>

              {seleccionado && (
                <SelectorPorcion
                  nombreIngrediente={ingrediente.nombre}
                  porcionActual={porcionElegida}
                  precioExtra={ingrediente.precio_extra}
                  onCambiar={(nuevaPorcion) =>
                    despachador({
                      type: 'CAMBIAR_PORCION',
                      id_paso: paso.id_paso,
                      id_ingrediente: idIng,
                      porcion: nuevaPorcion,
                    })
                  }
                />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: {
    gap: espaciado.md,
  },
  cabecera: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: espaciado.sm,
  },
  cabeceraTextos: {
    flex: 1,
    gap: 2,
  },
  titulo: {
    color: colores.texto,
    fontSize: 20,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  regla: {
    color: colores.textoSuave,
    fontSize: 13,
  },
  avisoMax: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '600',
  },
  lista: {
    gap: espaciado.sm + 2,
  },
  itemGrupo: {
    gap: 6,
  },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    padding: espaciado.md,
    borderRadius: radios.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  tarjetaSeleccionada: {
    borderWidth: 2,
    borderColor: colores.primario,
  },
  tarjetaDeshabilitada: {
    opacity: 0.45,
  },
  foto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  sinFoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  nombreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.xs + 2,
    flexWrap: 'wrap',
  },
  nombre: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  extraPrecio: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '700',
  },
  incluido: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  calorias: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  checkCirculo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkActivo: {
    backgroundColor: colores.primario,
    borderColor: colores.primario,
  },
  checkSimbolo: {
    color: colores.texto,
    fontSize: 13,
    fontWeight: '800',
  },
});
