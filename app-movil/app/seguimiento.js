import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import {
  ESTADOS_SEGUIMIENTO_MOVIL,
  PEDIDO_DEMO_SEGUIMIENTO,
} from '../src/services/seguimientoService';
import { formatearPrecio } from '../src/utils/formato';
import { colores, espaciado, radios } from '../src/theme';
import Card from '../src/components/ui/Card';
import Badge from '../src/components/ui/Badge';
import ProvisionalBanner from '../src/components/ui/ProvisionalBanner';

export default function SeguimientoScreen() {
  // En Etapa 1 usamos datos de demostración locales.
  // En R-23 este estado vendrá de GET /api/pedidos/movil/:id y actualizaciones en vivo
  // mediante suscribirSeguimientoSocket() + notificaciones push (expo-notifications).
  const [estadoDemo, setEstadoDemo] = useState(PEDIDO_DEMO_SEGUIMIENTO.estado);

  const indiceActual = ESTADOS_SEGUIMIENTO_MOVIL.findIndex(
    (e) => e.clave === estadoDemo
  );
  const infoActual =
    ESTADOS_SEGUIMIENTO_MOVIL[indiceActual] || ESTADOS_SEGUIMIENTO_MOVIL[0];

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenido}>
      <ProvisionalBanner
        variante="demo"
        titulo="Demostración · Datos de ejemplo"
        descripcion="Vista previa de seguimiento. En R-23 se conectará en tiempo real por Socket.io y notificaciones push."
      />

      <Card destacada style={styles.estadoCard}>
        <View style={styles.estadoTop}>
          <Badge variante="acento">{PEDIDO_DEMO_SEGUIMIENTO.codigo}</Badge>
          <Badge variante="neutro">{PEDIDO_DEMO_SEGUIMIENTO.canal}</Badge>
        </View>
        <Text style={styles.estadoTitulo}>{infoActual.etiqueta.toUpperCase()}</Text>
        <Text style={styles.estadoDesc}>{infoActual.descripcion}</Text>
      </Card>

      <Card style={styles.timelineCard}>
        <Text style={styles.seccionTitulo}>LÍNEA DE TIEMPO DEL PEDIDO</Text>
        <View style={styles.timeline}>
          {ESTADOS_SEGUIMIENTO_MOVIL.map((paso, idx) => {
            const completado = idx < indiceActual;
            const enCurso = idx === indiceActual;
            const ultimo = idx === ESTADOS_SEGUIMIENTO_MOVIL.length - 1;

            return (
              <View key={paso.clave} style={styles.pasoFila}>
                <View style={styles.indicadorCol}>
                  <View
                    style={[
                      styles.circulo,
                      completado && styles.circuloCompletado,
                      enCurso && styles.circuloActual,
                    ]}
                  >
                    <Text style={styles.circuloTexto}>
                      {completado ? '✓' : idx + 1}
                    </Text>
                  </View>
                  {!ultimo && (
                    <View
                      style={[
                        styles.lineaVertical,
                        completado && styles.lineaCompletada,
                      ]}
                    />
                  )}
                </View>

                <View style={styles.pasoTextos}>
                  <Text
                    style={[
                      styles.pasoTitulo,
                      (completado || enCurso) && styles.pasoTituloActivo,
                    ]}
                  >
                    {paso.etiqueta}
                  </Text>
                  <Text style={styles.pasoDesc}>{paso.descripcion}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={styles.simuladorCard}>
        <Text style={styles.seccionTitulo}>PROBAR ESTADOS (DEMOSTRACIÓN)</Text>
        <View style={styles.chipsWrap}>
          {ESTADOS_SEGUIMIENTO_MOVIL.map((paso) => {
            const activo = paso.clave === estadoDemo;
            return (
              <Pressable
                key={paso.clave}
                onPress={() => setEstadoDemo(paso.clave)}
                style={[styles.chip, activo && styles.chipActivo]}
              >
                <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>
                  {paso.etiqueta}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={styles.ordenCard}>
        <Text style={styles.seccionTitulo}>RESUMEN DE EJEMPLO</Text>
        {PEDIDO_DEMO_SEGUIMIENTO.items.map((item, idx) => (
          <View key={idx} style={styles.itemFila}>
            <Text style={styles.itemNombre}>
              {item.cantidad} × {item.nombre}
            </Text>
            <Text style={styles.itemPrecio}>
              {formatearPrecio(item.precio * item.cantidad)}
            </Text>
          </View>
        ))}
        <View style={styles.totalFila}>
          <Text style={styles.totalLabel}>Total (ejemplo)</Text>
          <Text style={styles.totalValor}>
            {formatearPrecio(PEDIDO_DEMO_SEGUIMIENTO.total)}
          </Text>
        </View>
      </Card>
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
  estadoCard: {
    gap: espaciado.sm,
  },
  estadoTop: {
    flexDirection: 'row',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  estadoTitulo: {
    color: colores.texto,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  estadoDesc: {
    color: colores.textoSuave,
    fontSize: 14,
    lineHeight: 20,
  },
  timelineCard: {
    gap: espaciado.md,
  },
  seccionTitulo: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  timeline: {
    gap: 2,
  },
  pasoFila: {
    flexDirection: 'row',
    gap: espaciado.md,
    minHeight: 58,
  },
  indicadorCol: {
    alignItems: 'center',
    width: 28,
  },
  circulo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colores.superficie2,
    borderWidth: 2,
    borderColor: colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circuloCompletado: {
    backgroundColor: colores.exito,
    borderColor: colores.exito,
  },
  circuloActual: {
    backgroundColor: colores.acento,
    borderColor: colores.acento,
  },
  circuloTexto: {
    color: colores.fondo,
    fontSize: 12,
    fontWeight: '900',
  },
  lineaVertical: {
    flex: 1,
    width: 2,
    backgroundColor: colores.borde,
    marginVertical: 3,
  },
  lineaCompletada: {
    backgroundColor: colores.exito,
  },
  pasoTextos: {
    flex: 1,
    paddingBottom: espaciado.md,
    gap: 2,
  },
  pasoTitulo: {
    color: colores.textoTenue,
    fontSize: 15,
    fontWeight: '800',
  },
  pasoTituloActivo: {
    color: colores.texto,
  },
  pasoDesc: {
    color: colores.textoSuave,
    fontSize: 12,
    lineHeight: 17,
  },
  simuladorCard: {
    gap: espaciado.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaciado.sm,
  },
  chip: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderRadius: radios.pill,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  chipActivo: {
    backgroundColor: colores.primario,
    borderColor: colores.primario,
  },
  chipTexto: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextoActivo: {
    color: colores.texto,
  },
  ordenCard: {
    gap: espaciado.sm,
  },
  itemFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemNombre: {
    color: colores.textoSuave,
    fontSize: 14,
  },
  itemPrecio: {
    color: colores.texto,
    fontSize: 14,
    fontWeight: '700',
  },
  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: espaciado.sm,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  totalLabel: {
    color: colores.texto,
    fontSize: 14,
    fontWeight: '800',
  },
  totalValor: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '900',
  },
});
