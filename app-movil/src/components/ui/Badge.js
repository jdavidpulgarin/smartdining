import { View, Text, StyleSheet } from 'react-native';
import { colores, radios } from '../../theme';

const ESTILOS_VARIANTE = {
  neutro: {
    bg: colores.superficie2,
    border: colores.borde,
    text: colores.textoSuave,
  },
  alerta: {
    bg: 'rgba(227, 36, 43, 0.16)',
    border: 'rgba(227, 36, 43, 0.4)',
    text: colores.primarioTexto,
  },
  acento: {
    bg: 'rgba(242, 183, 5, 0.16)',
    border: 'rgba(242, 183, 5, 0.4)',
    text: colores.acento,
  },
  exito: {
    bg: 'rgba(47, 163, 90, 0.18)',
    border: 'rgba(47, 163, 90, 0.4)',
    text: colores.exito,
  },
};

export default function Badge({ children, variante = 'neutro', style, textStyle }) {
  const conf = ESTILOS_VARIANTE[variante] || ESTILOS_VARIANTE.neutro;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: conf.bg, borderColor: conf.border },
        style,
      ]}
    >
      <Text style={[styles.texto, { color: conf.text }, textStyle]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radios.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  texto: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
});
