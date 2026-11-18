import { View, Pressable, Text, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';
import { formatearPrecio } from '../../utils/formato';

const OPCIONES_PORCION = [
  { valor: 'ligera', etiqueta: 'Ligera' },
  { valor: 'normal', etiqueta: 'Normal' },
  { valor: 'extra', etiqueta: 'Extra' },
];

export default function SelectorPorcion({
  nombreIngrediente = 'ingrediente',
  porcionActual = 'normal',
  precioExtra = 0,
  onCambiar,
}) {
  const extraNum = Number(precioExtra) || 0;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={`Porción de ${nombreIngrediente}`}
      style={styles.contenedor}
    >
      {OPCIONES_PORCION.map((opcion) => {
        const activa = porcionActual === opcion.valor;
        const mostrarExtra = opcion.valor === 'extra' && extraNum > 0;

        return (
          <Pressable
            key={opcion.valor}
            onPress={() => onCambiar?.(opcion.valor)}
            accessibilityRole="radio"
            accessibilityState={{ checked: activa }}
            style={[styles.boton, activa && styles.botonActivo]}
          >
            <Text style={[styles.etiqueta, activa && styles.etiquetaActiva]}>
              {opcion.etiqueta}
            </Text>
            {mostrarExtra ? (
              <Text style={[styles.extra, activa && styles.extraActivo]}>
                +{formatearPrecio(extraNum)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: radios.md,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  boton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.sm,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonActivo: {
    backgroundColor: colores.primario,
  },
  etiqueta: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  etiquetaActiva: {
    color: colores.texto,
  },
  extra: {
    color: colores.primarioTexto,
    fontSize: 11,
    fontWeight: '700',
  },
  extraActivo: {
    color: colores.texto,
  },
});
