import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCarrito } from '../src/context/CarritoContext';
import { calcularSubtotalLinea } from '../src/utils/carrito';
import { formatearPrecio } from '../src/utils/formato';
import {
  CANALES_PEDIDO,
  BARRIOS_PROVISIONALES,
} from '../src/services/pedidosService';
import { colores, espaciado, radios } from '../src/theme';
import Card from '../src/components/ui/Card';
import Button from '../src/components/ui/Button';
import Badge from '../src/components/ui/Badge';
import ProvisionalBanner from '../src/components/ui/ProvisionalBanner';

export default function CheckoutScreen() {
  const router = useRouter();
  const { lineas, total } = useCarrito();

  const [canal, setCanal] = useState(CANALES_PEDIDO.PARA_LLEVAR);
  const [direccion, setDireccion] = useState('');
  const [barrioId, setBarrioId] = useState(BARRIOS_PROVISIONALES[0].id);
  const [referencia, setReferencia] = useState('');

  const esDomicilio = canal === CANALES_PEDIDO.DOMICILIO;

  return (
    <ScrollView
      style={styles.pantalla}
      contentContainerStyle={styles.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <ProvisionalBanner
        titulo="Disponible pronto"
        descripcion="El envío de pedidos y el pago en línea con Wompi se habilitarán al conectar el backend (D-20)."
      />

      <Card style={styles.card}>
        <Text style={styles.seccionTitulo}>1. TIPO DE ENTREGA</Text>
        <View style={styles.canalRow}>
          <Pressable
            onPress={() => setCanal(CANALES_PEDIDO.PARA_LLEVAR)}
            accessibilityRole="radio"
            accessibilityState={{ checked: !esDomicilio }}
            style={[styles.canalBtn, !esDomicilio && styles.canalBtnActivo]}
          >
            <Text style={[styles.canalTitulo, !esDomicilio && styles.canalActivoTexto]}>
              Para llevar
            </Text>
            <Text style={styles.canalSub}>Recoges en el local</Text>
          </Pressable>

          <Pressable
            onPress={() => setCanal(CANALES_PEDIDO.DOMICILIO)}
            accessibilityRole="radio"
            accessibilityState={{ checked: esDomicilio }}
            style={[styles.canalBtn, esDomicilio && styles.canalBtnActivo]}
          >
            <Text style={[styles.canalTitulo, esDomicilio && styles.canalActivoTexto]}>
              Domicilio
            </Text>
            <Text style={styles.canalSub}>Envío a tu dirección</Text>
          </Pressable>
        </View>
      </Card>

      {esDomicilio && (
        <Card style={styles.card}>
          <View style={styles.headerProvisional}>
            <Text style={styles.seccionTitulo}>2. DIRECCIÓN DE ENTREGA</Text>
            <Badge variante="acento">Lista provisional</Badge>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>DIRECCIÓN EXACTA</Text>
            <TextInput
              value={direccion}
              onChangeText={setDireccion}
              placeholder="Ej: Calle 10 # 20-30, Apto 401"
              placeholderTextColor={colores.textoTenue}
              style={styles.input}
            />
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>
              BARRIO (EJEMPLO PROVISIONAL · PENDIENTE D-20)
            </Text>
            <View style={styles.barriosWrap}>
              {BARRIOS_PROVISIONALES.map((barrio) => {
                const activo = barrio.id === barrioId;
                return (
                  <Pressable
                    key={barrio.id}
                    onPress={() => setBarrioId(barrio.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: activo }}
                    style={[styles.barrioChip, activo && styles.barrioChipActivo]}
                  >
                    <Text
                      style={[
                        styles.barrioTexto,
                        activo && styles.barrioTextoActivo,
                      ]}
                    >
                      {barrio.nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.campo}>
            <Text style={styles.label}>REFERENCIA / INDICACIONES (OPCIONAL)</Text>
            <TextInput
              value={referencia}
              onChangeText={setReferencia}
              placeholder="Ej: Portería torre B, timbre 401"
              placeholderTextColor={colores.textoTenue}
              style={styles.input}
            />
          </View>
        </Card>
      )}

      <Card style={styles.card}>
        <Text style={styles.seccionTitulo}>
          {esDomicilio ? '3. RESUMEN DEL PEDIDO' : '2. RESUMEN DEL PEDIDO'}
        </Text>

        {lineas.length === 0 ? (
          <Text style={styles.vacioTexto}>
            No tienes productos en el carrito todavía.
          </Text>
        ) : (
          <View style={styles.resumenLista}>
            {lineas.map((linea) => (
              <View key={linea.id_linea} style={styles.resumenFila}>
                <Text style={styles.resumenNombre} numberOfLines={1}>
                  {linea.cantidad} × {linea.nombre}
                </Text>
                <Text style={styles.resumenPrecio}>
                  {formatearPrecio(calcularSubtotalLinea(linea))}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalFila}>
          <Text style={styles.totalLabel}>Total a pagar</Text>
          <Text style={styles.totalValor}>{formatearPrecio(total)}</Text>
        </View>
      </Card>

      <View style={styles.acciones}>
        <Button disabled onPress={() => {}}>
          Pagar con Wompi · Disponible pronto
        </Button>

        <Button
          variante="secundario"
          onPress={() => router.push('/seguimiento')}
        >
          Ver vista previa de seguimiento (demo)
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  contenido: {
    padding: espaciado.lg,
    gap: espaciado.lg,
    paddingBottom: espaciado.xxl,
  },
  card: {
    gap: espaciado.md,
  },
  headerProvisional: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  seccionTitulo: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  canalRow: {
    flexDirection: 'row',
    gap: espaciado.md,
  },
  canalBtn: {
    flex: 1,
    padding: espaciado.md,
    borderRadius: radios.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie2,
    gap: 4,
  },
  canalBtnActivo: {
    borderWidth: 2,
    borderColor: colores.primario,
  },
  canalTitulo: {
    color: colores.textoSuave,
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  canalActivoTexto: {
    color: colores.texto,
  },
  canalSub: {
    color: colores.textoTenue,
    fontSize: 12,
  },
  campo: {
    gap: 6,
  },
  label: {
    color: colores.textoSuave,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  input: {
    minHeight: 46,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radios.md,
    paddingHorizontal: espaciado.md,
    color: colores.texto,
    fontSize: 14,
  },
  barriosWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaciado.sm,
  },
  barrioChip: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderRadius: radios.pill,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  barrioChipActivo: {
    backgroundColor: colores.primario,
    borderColor: colores.primario,
  },
  barrioTexto: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '700',
  },
  barrioTextoActivo: {
    color: colores.texto,
  },
  vacioTexto: {
    color: colores.textoTenue,
    fontSize: 13,
  },
  resumenLista: {
    gap: espaciado.sm,
  },
  resumenFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaciado.md,
  },
  resumenNombre: {
    flex: 1,
    color: colores.textoSuave,
    fontSize: 14,
  },
  resumenPrecio: {
    color: colores.texto,
    fontSize: 14,
    fontWeight: '700',
  },
  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: espaciado.md,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  totalLabel: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: '800',
  },
  totalValor: {
    color: colores.texto,
    fontSize: 22,
    fontWeight: '900',
  },
  acciones: {
    gap: espaciado.md,
  },
});
