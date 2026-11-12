import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCarrito } from '../../src/context/CarritoContext';
import { calcularSubtotalLinea } from '../../src/utils/carrito';
import { formatearPrecio } from '../../src/utils/formato';
import { colores, espaciado, radios } from '../../src/theme';
import Card from '../../src/components/ui/Card';
import Button from '../../src/components/ui/Button';
import Badge from '../../src/components/ui/Badge';

export default function CarritoScreen() {
  const router = useRouter();
  const {
    lineas,
    total,
    totalUnidades,
    actualizarCantidad,
    actualizarNotas,
    eliminarLinea,
    vaciarCarrito,
  } = useCarrito();

  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);

  if (lineas.length === 0) {
    return (
      <View style={styles.vacioCont}>
        <Card style={styles.vacioCard}>
          <Text style={styles.vacioIcono}>🛒</Text>
          <Text style={styles.vacioTitulo}>TU CARRITO ESTÁ VACÍO</Text>
          <Text style={styles.vacioTexto}>
            Aún no has agregado platos. Explora el menú o arma uno a tu gusto.
          </Text>
          <Button onPress={() => router.push('/(tabs)/menu')}>
            Explorar menú
          </Button>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.pantalla}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <View style={styles.barraConteo}>
          <Text style={styles.conteoTexto}>
            {totalUnidades} {totalUnidades === 1 ? 'producto' : 'productos'} en tu carrito
          </Text>

          {confirmandoVaciar ? (
            <View style={styles.confirmRow}>
              <Pressable
                onPress={() => {
                  vaciarCarrito();
                  setConfirmandoVaciar(false);
                }}
              >
                <Text style={styles.confirmarSi}>Sí, vaciar</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmandoVaciar(false)}>
                <Text style={styles.confirmarNo}>Cancelar</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setConfirmandoVaciar(true)}>
              <Text style={styles.vaciarTexto}>Vaciar carrito</Text>
            </Pressable>
          )}
        </View>

        {lineas.map((linea) => {
          const subtotal = calcularSubtotalLinea(linea);
          return (
            <Card key={linea.id_linea} style={styles.lineaCard}>
              <View style={styles.lineaTop}>
                {linea.imagen ? (
                  <Image
                    source={{ uri: linea.imagen }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : null}

                <View style={styles.lineaInfo}>
                  <Text style={styles.lineaNombre}>{linea.nombre}</Text>
                  <Text style={styles.lineaPrecioUnit}>
                    {formatearPrecio(linea.precioUnitario)} c/u
                  </Text>
                  {linea.calorias != null ? (
                    <Badge variante="neutro">{linea.calorias} kcal</Badge>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => eliminarLinea(linea.id_linea)}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar ${linea.nombre}`}
                  style={styles.quitarBtn}
                >
                  <Text style={styles.quitarTexto}>Quitar</Text>
                </Pressable>
              </View>

              {Array.isArray(linea.detalle) && linea.detalle.length > 0 && (
                <View style={styles.detalleLista}>
                  {linea.detalle.map((d, idx) => (
                    <Text
                      key={`${linea.id_linea}-det-${idx}`}
                      style={styles.detalleItem}
                    >
                      • {d.nombre} ({d.porcion})
                    </Text>
                  ))}
                </View>
              )}

              <View style={styles.notasBloque}>
                <Text style={styles.notasEtiqueta}>Notas para cocina</Text>
                <TextInput
                  value={linea.notas || ''}
                  onChangeText={(texto) => actualizarNotas(linea.id_linea, texto)}
                  maxLength={200}
                  placeholder="Agregar nota (ej: sin cebolla)"
                  placeholderTextColor={colores.textoTenue}
                  style={styles.notasInput}
                />
              </View>

              <View style={styles.lineaPie}>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() =>
                      actualizarCantidad(linea.id_linea, linea.cantidad - 1)
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Disminuir cantidad"
                    style={styles.stepBtn}
                  >
                    <Text style={styles.stepTexto}>−</Text>
                  </Pressable>
                  <Text style={styles.cantidad}>{linea.cantidad}</Text>
                  <Pressable
                    onPress={() =>
                      actualizarCantidad(linea.id_linea, linea.cantidad + 1)
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Aumentar cantidad"
                    style={styles.stepBtn}
                  >
                    <Text style={styles.stepTexto}>+</Text>
                  </Pressable>
                </View>

                <Text style={styles.subtotal}>{formatearPrecio(subtotal)}</Text>
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL DEL PEDIDO</Text>
          <Text style={styles.totalValor}>{formatearPrecio(total)}</Text>
        </View>
        <Button onPress={() => router.push('/checkout')}>
          Continuar al pedido
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  vacioCont: {
    flex: 1,
    backgroundColor: colores.fondo,
    justifyContent: 'center',
    padding: espaciado.lg,
  },
  vacioCard: {
    alignItems: 'center',
    gap: espaciado.md,
    paddingVertical: espaciado.xl,
  },
  vacioIcono: {
    fontSize: 38,
  },
  vacioTitulo: {
    color: colores.texto,
    fontSize: 20,
    fontWeight: '900',
  },
  vacioTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  contenido: {
    padding: espaciado.lg,
    gap: espaciado.md,
    paddingBottom: espaciado.xxl,
  },
  barraConteo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conteoTexto: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: '600',
  },
  vaciarTexto: {
    color: colores.primarioTexto,
    fontSize: 13,
    fontWeight: '700',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: espaciado.md,
  },
  confirmarSi: {
    color: colores.primarioTexto,
    fontSize: 13,
    fontWeight: '800',
  },
  confirmarNo: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: '600',
  },
  lineaCard: {
    gap: espaciado.md,
  },
  lineaTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.md,
  },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: radios.sm,
    backgroundColor: colores.superficie2,
  },
  lineaInfo: {
    flex: 1,
    gap: 4,
  },
  lineaNombre: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  lineaPrecioUnit: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  quitarBtn: {
    paddingHorizontal: espaciado.sm,
    paddingVertical: 4,
  },
  quitarTexto: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '700',
  },
  detalleLista: {
    backgroundColor: colores.superficie2,
    borderRadius: radios.sm,
    padding: espaciado.sm + 2,
    gap: 2,
  },
  detalleItem: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  notasBloque: {
    gap: 4,
  },
  notasEtiqueta: {
    color: colores.textoSuave,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  notasInput: {
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    color: colores.texto,
    fontSize: 13,
  },
  lineaPie: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: espaciado.sm,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm + 2,
  },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: radios.sm,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTexto: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '700',
  },
  cantidad: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: '800',
    minWidth: 22,
    textAlign: 'center',
  },
  subtotal: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '900',
  },
  footer: {
    backgroundColor: colores.superficie,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    padding: espaciado.lg,
    gap: espaciado.md,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  totalValor: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: '900',
  },
});
